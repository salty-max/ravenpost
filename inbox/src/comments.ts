import * as events from "./events";
import * as push from "./push";
import { ADDONS } from "./stats";
import * as store from "./store";

/**
 * The players' comments on CurseForge, watched (/api/cron/comments, every 30
 * minutes): the site's own JSON, what its comments page reads
 * (www.curseforge.com/api/v1/mods/<id>/comments, no key), every comment and
 * reply each addon's latest threads hold. One the inbox hasn't seen
 * (comments/seen.json), by someone else than the owner (CURSEFORGE_AUTHOR,
 * their name there; saltymax by default), becomes an event and a word to the
 * owner's phone, a link to answer it. The first look only learns what is
 * there.
 */
export type Comment = { id: number; project: number; author: string; text: string; at: string; reply: boolean };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setCommentsFetch = (f: FetchFn) => {
  fetchImpl = f;
};

type Raw = { id: number; text?: string; projectId: number; author?: { displayName?: string; username?: string }; datePosted: number; replies?: Raw[] };

/** A project's latest threads, their replies with them, flattened. */
export async function commentsOf(project: number): Promise<Comment[]> {
  const res = await fetchImpl(`https://www.curseforge.com/api/v1/mods/${project}/comments?page=0&size=50`, {
    headers: { "User-Agent": "Mozilla/5.0 (ravenpost-inbox; comment watcher)", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`curseforge ${project}: ${res.status}`);
  const out: Comment[] = [];
  const add = (c: Raw, reply: boolean) =>
    out.push({
      id: c.id,
      project: c.projectId ?? project,
      author: c.author?.displayName ?? c.author?.username ?? "someone",
      text: (c.text ?? "").replace(/\s+/g, " ").trim(),
      at: new Date(c.datePosted).toISOString(),
      reply,
    });
  for (const c of ((await res.json()) as { data?: Raw[] }).data ?? []) {
    add(c, false);
    for (const r of c.replies ?? []) add(r, true);
  }
  return out;
}

const SEEN = "comments/seen.json";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function watch(): Promise<{ looked: number; fresh: number; told: number; failed: string[] }> {
  const was = JSON.parse((await store.read(SEEN)) ?? "null") as { ids: number[] } | null;
  const seen = new Set(was?.ids ?? []);
  const owner = (process.env.CURSEFORGE_AUTHOR ?? "saltymax").toLowerCase();
  const failed: string[] = [];
  let looked = 0, fresh = 0, told = 0;
  for (const [name, project, slug, , repo] of ADDONS) {
    if (!project) continue;
    let list: Comment[];
    try {
      list = await commentsOf(project);
    } catch (err) {
      failed.push(String(err));
      continue;
    }
    looked += list.length;
    const theirs = list.filter((c) => !seen.has(c.id) && c.author.toLowerCase() !== owner).sort((a, b) => a.at.localeCompare(b.at));
    for (const c of list) seen.add(c.id);
    if (!was || !theirs.length) continue;
    fresh += theirs.length;
    const url = `https://www.curseforge.com/wow/addons/${slug ?? repo}/comments`;
    // (a few: a word each; many at once: one word for them all)
    const words =
      theirs.length > 3
        ? [{ title: `${theirs.length} new comments on ${name}`, body: theirs.map((c) => `${c.author}: ${clip(c.text, 90)}`).join("\n") }]
        : theirs.map((c) => ({ title: `${c.author} ${c.reply ? "replied" : "commented"} on ${name}`, body: clip(c.text, 600) }));
    for (const w of words) {
      await events.add({ at: new Date().toISOString(), kind: "comment", repo, title: w.title, body: w.body, url });
      const r = await push.notify({ title: w.title, body: clip(w.body, 240), url: "/stats#activity", tag: `comment-${repo}` });
      told += r.sent;
    }
  }
  // (every id seen kept, the latest thousands: a thread drops off page one long after)
  await store.write(SEEN, JSON.stringify({ ids: [...seen].slice(-5000) }));
  if (failed.length) console.error(JSON.stringify({ comments: "failed", failed }));
  return { looked, fresh, told, failed };
}
