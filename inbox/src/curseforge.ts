import * as events from "./events";
import * as push from "./push";
import { ADDONS } from "./stats";
import * as store from "./store";

/**
 * Each addon's releases on CurseForge and their downloads, looked at every 10
 * minutes with the comments (/api/cron/curseforge): the site's own JSON
 * (www.curseforge.com/api/v1/mods/<id>/files, no key: every public release,
 * its downloads as they come; their sum is the addon's total, cfwidget's
 * number). Kept:
 *   downloads/<day>.json   the day's readings: each addon's total, each look
 *                          (14 days kept: the dashboard's last 48 hours)
 *   releases/latest.json   each addon's releases (version, date, downloads)
 *   releases/seen.json     every release id ever seen, by addon (an addon
 *                          can have more releases than the dashboard keeps)
 * A release not seen before is live (the public list holds only what passed
 * CurseForge's review): an event, the owner's phone told. The first look
 * learns what is there.
 */
export type Release = { id: number; version: string; at: string; downloads: number; type: number };
export type Reading = [at: string, totals: Record<string, number>];

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setCurseForgeFetch = (f: FetchFn) => {
  fetchImpl = f;
};

/** A project's public releases, the newest first. */
export async function releasesOf(project: number): Promise<Release[]> {
  const out: Release[] = [];
  for (let page = 0; ; page++) {
    const res = await fetchImpl(`https://www.curseforge.com/api/v1/mods/${project}/files?pageIndex=${page}&pageSize=50&sort=dateCreated&sortDescending=true`, {
      headers: { "User-Agent": "Mozilla/5.0 (ravenpost-inbox; download counter)", Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`curseforge ${project}: ${res.status}`);
    const body = (await res.json()) as { data?: { id: number; displayName: string; dateCreated: string; totalDownloads: number; releaseType: number }[]; pagination?: { totalCount?: number } };
    if (!Array.isArray(body.data)) throw new Error(`curseforge ${project}: missing files`);
    out.push(...body.data.map((f) => ({ id: f.id, version: f.displayName, at: f.dateCreated, downloads: f.totalDownloads ?? 0, type: f.releaseType ?? 1 })));
    if (body.data.length < 50 || (body.pagination?.totalCount !== undefined && out.length >= body.pagination.totalCount)) return out;
  }
}

const LATEST = "releases/latest.json";
const SEEN = "releases/seen.json";
// (a release's name without its addon's: "Lorekeeper's Codex 0.6.0 (Classic)" is 0.6.0 (Classic))
const versionOf = (name: string, display: string) => display.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "") || display;
const dayFile = (iso: string) => `downloads/${iso.slice(0, 10)}.json`;
const KEEP_DAYS = 14;
const TYPES: Record<number, string> = { 2: "beta ", 3: "alpha " };

export async function readings(day: string): Promise<Reading[]> {
  return (JSON.parse((await store.read(`downloads/${day}.json`)) ?? '{"readings":[]}') as { readings: Reading[] }).readings;
}
export async function latest(): Promise<Record<string, Release[]>> {
  return JSON.parse((await store.read(LATEST)) ?? "{}") as Record<string, Release[]>;
}

export async function look(now = new Date()): Promise<{ addons: number; live: string[]; failed: string[] }> {
  const was = JSON.parse((await store.read(LATEST)) ?? "null") as Record<string, Release[]> | null;
  const kept: Record<string, Release[]> = { ...was };
  // (every id seen: a release past the dashboard's twenty is no new one; the
  // first look with this file learns the ids of every release there is)
  const seenWas = JSON.parse((await store.read(SEEN)) ?? "null") as Record<string, number[]> | null;
  const seen: Record<string, number[]> = { ...seenWas };
  const totals: Record<string, number> = {};
  const live: string[] = [];
  const failed: string[] = [];
  for (const [name, project, slug, , repo] of ADDONS) {
    if (!project) continue;
    let list: Release[];
    try {
      list = await releasesOf(project);
    } catch (err) {
      failed.push(String(err));
      continue;
    }
    for (const r of list) r.version = versionOf(name, r.version);
    totals[name] = list.reduce((t, r) => t + r.downloads, 0);
    kept[name] = list.slice(0, 20);
    const known = new Set(seen[name] ?? []);
    seen[name] = [...new Set([...(seen[name] ?? []), ...list.map((r) => r.id)])];
    if (!was || !seenWas) continue;
    for (const r of list.filter((r) => !known.has(r.id)).reverse()) {
      const title = `${name} ${TYPES[r.type] ?? ""}${r.version} is live on CurseForge`;
      live.push(title);
      await events.add({ at: now.toISOString(), kind: "release", repo, title, body: "It passed CurseForge's review: players can download it now.", url: `https://www.curseforge.com/wow/addons/${slug ?? repo}/files` });
      await push.notify({ title, body: "Players can download it now.", url: "/stats#activity", tag: `release-${repo}` });
    }
  }
  await store.write(LATEST, JSON.stringify(kept));
  await store.write(SEEN, JSON.stringify(seen));
  // (15 October: the releases past the twentieth were told live every look;
  // their words go from the activity, once)
  if (!seenWas) {
    const all = await events.recent();
    const kept_ = all.filter((e) => e.kind !== "release");
    if (kept_.length !== all.length) await events.replace(kept_);
  }
  // (the day's readings, one each look; the oldest days dropped)
  if (Object.keys(totals).length) {
    const iso = now.toISOString();
    const day = await readings(iso.slice(0, 10));
    day.push([iso, totals]);
    await store.write(dayFile(iso), JSON.stringify({ readings: day }));
    const cut = `downloads/${new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)}`;
    await store.remove((await store.all("downloads/")).filter((n) => n < cut));
  }
  if (failed.length) console.error(JSON.stringify({ curseforge: "failed", failed }));
  return { addons: Object.keys(totals).length, live, failed };
}
