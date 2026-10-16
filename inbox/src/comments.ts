import * as events from "./events";
import * as push from "./push";
import { ADDONS } from "./stats";
import * as store from "./store";

/**
 * The players' comments on CurseForge, watched (/api/cron/curseforge, every 10
 * minutes): the site's own JSON, what its comments page reads
 * (www.curseforge.com/api/v1/mods/<id>/comments, no key), every comment and
 * reply each addon's latest threads hold. One the inbox hasn't seen
 * (comments/seen.json), by someone else than the owner (CURSEFORGE_AUTHOR,
 * their name there; saltymax by default), becomes an event and a word to the
 * owner's phone, a link to answer it. The first look only learns what is
 * there. Each look also keeps the addons' latest threads for the dashboard
 * (comments/recent.json): who wrote, the replies, whether the owner had the
 * last word.
 */
export type Comment = { id: number; project: number; author: string; text: string; at: string; reply: boolean };
export type Thread = { addon: string; repo: string; url: string; id: number; author: string; text: string; at: string; last: string; replies: { author: string; text: string; at: string; owner: boolean }[]; answered: boolean };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setCommentsFetch = (f: FetchFn) => {
  fetchImpl = f;
};

type Raw = { id: number; text?: string; projectId: number; author?: { displayName?: string; username?: string }; datePosted: number; replies?: Raw[] };

const owner = () => (process.env.CURSEFORGE_AUTHOR ?? "saltymax").toLowerCase();
const nameOf = (c: Raw) => c.author?.displayName ?? c.author?.username ?? "someone";
const words = (c: Raw) => (c.text ?? "").replace(/\s+/g, " ").trim();

/** A project's latest threads, as the site gives them. */
async function rawThreads(project: number): Promise<Raw[]> {
  const res = await fetchImpl(`https://www.curseforge.com/api/v1/mods/${project}/comments?page=0&size=50`, {
    headers: { "User-Agent": "Mozilla/5.0 (ravenpost-inbox; comment watcher)", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`curseforge ${project}: ${res.status}`);
  return ((await res.json()) as { data?: Raw[] }).data ?? [];
}

/** Replies can themselves have replies. Keep each comment once at any depth. */
function allComments(roots: Raw[]): Raw[] {
  const found = new Map<number, Raw>();
  const visit = (list: Raw[]) => {
    for (const c of list) {
      if (found.has(c.id)) continue;
      found.set(c.id, c);
      visit(c.replies ?? []);
    }
  };
  visit(roots);
  return [...found.values()];
}

/** Threads, their replies at every depth, flattened. */
function flatten(project: number, threads: Raw[]): Comment[] {
  const roots = new Set(threads.map((c) => c.id));
  return allComments(threads).map((c) => ({ id: c.id, project: c.projectId ?? project, author: nameOf(c), text: words(c), at: new Date(c.datePosted).toISOString(), reply: !roots.has(c.id) }));
}

/** A project's latest threads, their replies with them, flattened. */
export async function commentsOf(project: number): Promise<Comment[]> {
  return flatten(project, await rawThreads(project));
}

/** A thread as the dashboard shows it: the owner's last word or not. */
function threadOf(addon: string, repo: string, url: string, c: Raw): Thread {
  const replies = allComments(c.replies ?? [])
    .sort((a, b) => a.datePosted - b.datePosted)
    .map((r) => ({ author: nameOf(r), text: words(r), at: new Date(r.datePosted).toISOString(), owner: nameOf(r).toLowerCase() === owner() }));
  const mine = nameOf(c).toLowerCase() === owner();
  const at = new Date(c.datePosted).toISOString();
  return { addon, repo, url, id: c.id, author: nameOf(c), text: words(c), at, last: replies.length ? replies[replies.length - 1].at : at, replies, answered: replies.length > 0 ? replies[replies.length - 1].owner : mine };
}

const RECENT = "comments/recent.json";
export async function recentThreads(): Promise<Thread[]> {
  return (JSON.parse((await store.read(RECENT)) ?? '{"threads":[]}') as { threads: Thread[] }).threads;
}

const SEEN = "comments/seen.json";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function watch(): Promise<{ looked: number; fresh: number; told: number; failed: string[] }> {
  const was = JSON.parse((await store.read(SEEN)) ?? "null") as { ids: number[] } | null;
  const seen = new Set(was?.ids ?? []);
  const failed: string[] = [];
  const threads: Thread[] = [];
  const kept = new Map((await recentThreads()).map((t) => [t.id, t]));
  let looked = 0, fresh = 0, told = 0;
  for (const [name, project, slug, , repo] of ADDONS) {
    if (!project) continue;
    const url = `https://www.curseforge.com/wow/addons/${slug ?? repo}/comments`;
    let raw: Raw[];
    try {
      raw = await rawThreads(project);
    } catch (err) {
      failed.push(String(err));
      // (its threads as last seen)
      threads.push(...[...kept.values()].filter((t) => t.repo === repo));
      continue;
    }
    threads.push(...raw.map((c) => threadOf(name, repo, url, c)));
    const list = flatten(project, raw);
    looked += list.length;
    const theirs = list.filter((c) => !seen.has(c.id) && c.author.toLowerCase() !== owner()).sort((a, b) => a.at.localeCompare(b.at));
    for (const c of list) seen.add(c.id);
    if (!was || !theirs.length) continue;
    fresh += theirs.length;
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
  threads.sort((a, b) => b.last.localeCompare(a.last));
  await store.write(RECENT, JSON.stringify({ at: new Date().toISOString(), threads: threads.slice(0, 60) }));
  if (failed.length) console.error(JSON.stringify({ comments: "failed", failed }));
  return { looked, fresh, told, failed };
}
