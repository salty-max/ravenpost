import { createHmac } from "node:crypto";
import * as store from "./store";

/**
 * The numbers, for the dashboard (/stats): one entry a day in
 * stats/history.json, filled by the daily job (/api/cron/stats, Vercel Cron):
 *   downloads  each addon's totals on CurseForge (its own JSON, else cfwidget), Wago and GitHub, Ravenpost's
 *              releases (totals as of that day: download events, not players)
 *   ravenpost  the installs that pinged that day (one anonymous ping a day:
 *              a hash of a random install id, its version, system, links)
 *   sharing    that day's uploads of facts: sharers, uploads, facts, by game
 *              and language (counted as they come, by the sharer's hash)
 *   merged     observations newly archived by wow-data, not database gaps filled
 *   traffic    the sites' page views and visitors (Vercel Web Analytics'
 *              API, when VERCEL_ANALYTICS_TOKEN is set)
 *   curseforge each addon's standing there: its rank among every WoW addon
 *              by popularity, its favorites and thumbs up (CurseForge's
 *              official API, when CURSEFORGE_API_KEY is set)
 * The day's pings and counts are dropped once counted: only the sums stay.
 */
export type Day = {
  downloads?: Record<string, { curseforge?: number; wago?: number; github?: number }>;
  downloadsAt?: string;
  ravenpost?: { installs: number; versions: Record<string, number>; os: Record<string, number>; linked: Record<string, number>; sharing: number };
  sharing?: { sharers: number; uploads: number; facts: number; games: Record<string, number>; locales: Record<string, number> };
  merged?: Record<string, { uploads: number; newFacts: number }>;
  traffic?: Record<string, { pageviews: number; visitors: number }>;
  curseforge?: Record<string, { rank?: number; favorites?: number; likes?: number }>;
};
export type History = { updated?: string; days: Record<string, Day> };

export const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
const yesterday = (d = new Date()) => dayOf(new Date(d.getTime() - 86_400_000));
const key = (s: string) => createHmac("sha256", process.env.INBOX_SECRET ?? "local-only-secret").update(s).digest("hex").slice(0, 16);
const bump = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};

// ── Ravenpost's ping ─────────────────────────────────────────────────────────
const SYSTEMS = new Set(["darwin", "windows", "linux"]);
const LINKS = new Set(["hearthtale", "wowlocker", "shared"]);
export type Ping = { id: string; version: string; os: string; arch: string; linked: string[]; sharing: number };

/** A ping as Ravenpost sends it, checked; null when it isn't one. */
export function readPing(body: unknown): Ping | null {
  const b = body as Partial<Ping> | null;
  if (!b || typeof b.id !== "string" || !/^[0-9a-f]{32}$/.test(b.id)) return null;
  const word = (v: unknown, max: number) => (typeof v === "string" && /^[\w.+-]{1,40}$/.test(v) && v.length <= max ? v : "?");
  return {
    id: b.id,
    version: word(b.version, 20),
    os: SYSTEMS.has(b.os as string) ? (b.os as string) : "?",
    arch: word(b.arch, 10),
    linked: Array.isArray(b.linked) ? b.linked.filter((l): l is string => typeof l === "string" && LINKS.has(l)) : [],
    sharing: Number.isInteger(b.sharing) && (b.sharing as number) >= 0 && (b.sharing as number) < 100 ? (b.sharing as number) : 0,
  };
}

/** One file an install a day (a ping again the same day replaces it). */
export async function ping(p: Ping, now = new Date()): Promise<void> {
  const { id, ...rest } = p;
  await store.write(`pings/${dayOf(now)}/${key(`install:${id}`)}.json`, JSON.stringify(rest));
}

// ── a day's uploads, by sharer ───────────────────────────────────────────────
type Count = { uploads: number; facts: number; games: Record<string, number>; locales: Record<string, number> };

/** An upload counted on its sharer's line for the day. */
export async function countUpload(sub: string, game: string, locales: Record<string, number>, now = new Date()): Promise<void> {
  const name = `counts/${dayOf(now)}/${key(`sharer:${sub}`)}.json`;
  const c: Count = JSON.parse((await store.read(name)) ?? '{"uploads":0,"facts":0,"games":{},"locales":{}}');
  const n = Object.values(locales).reduce((a, b) => a + b, 0);
  c.uploads++;
  c.facts += n;
  bump(c.games, game, n);
  for (const [l, k] of Object.entries(locales)) bump(c.locales, l, k);
  await store.write(name, JSON.stringify(c));
}

// ── the history ──────────────────────────────────────────────────────────────
const HISTORY = "stats/history.json";

export async function history(): Promise<History> {
  return JSON.parse((await store.read(HISTORY)) ?? '{"days":{}}') as History;
}

/** Some days' numbers into the history (each part of a day replaced whole). */
export async function record(days: Record<string, Day>): Promise<History> {
  const h = await history();
  for (const [day, d] of Object.entries(days)) h.days[day] = { ...h.days[day], ...d };
  h.updated = new Date().toISOString();
  await store.write(HISTORY, JSON.stringify(h));
  return h;
}

// ── downloads ────────────────────────────────────────────────────────────────
// Each addon's CurseForge project, Wago slug and id, GitHub repository
// (the user's ideas/downloads.py, now daily here).
export const ADDONS: [name: string, curseforge: number | null, wagoSlug: string | null, wagoId: string | null, repo: string][] = [
  ["Lorekeeper's Codex", 1727545, "lorekeepers-codex", "j6jAL0NR", "lorekeepers-codex"],
  ["Yonder", 1728396, "yonder", "ZKbq5y61", "yonder"],
  ["Hearthtale", 1737290, "hearthtale", "E6gzPnN1", "hearthtale"],
  ["WoWLocker", 1724925, "wowlocker", "YK9x886L", "wow-locker"],
  ["Keyring", 1739386, "keyring", "ANz7JV64", "keyring"],
  ["Second Wind", 1739380, "second-wind", "XKqEjbKy", "second-wind"],
  ["Ravenpost", null, null, null, "ravenpost"],
];

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setStatsFetch = (f: FetchFn) => {
  fetchImpl = f;
};
const UA = { "User-Agent": "Mozilla/5.0 (ravenpost-inbox; download counters)" };

// (CurseForge's own JSON first, its releases' downloads summed: cfwidget's
// number, without the middleman; cfwidget should it refuse)
async function curseforge(id: number): Promise<number | undefined> {
  const own = await settle(fetchImpl(`https://www.curseforge.com/api/v1/mods/${id}/files?pageIndex=0&pageSize=50`, { headers: UA, signal: AbortSignal.timeout(20_000) }));
  if (own?.ok) {
    const files = ((await own.json()) as { data?: { totalDownloads?: number }[]; pagination?: { totalCount?: number } });
    if (files.data && (files.pagination?.totalCount ?? 0) <= 50) return files.data.reduce((t, f) => t + (f.totalDownloads ?? 0), 0);
  }
  const r = await fetchImpl(`https://api.cfwidget.com/${id}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  return r.ok ? ((await r.json()) as { downloads?: { total?: number } }).downloads?.total : undefined;
}

async function wago(slug: string, id: string): Promise<number | undefined> {
  const r = await fetchImpl(`https://addons.wago.io/addons/${slug}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return undefined;
  const page = (await r.text()).replace(/&quot;/g, '"');
  if (!page.includes(`"id":"${id}"`)) return undefined; // (another addon took the slug)
  const m = page.match(/"download_count":(\d+)/);
  return m ? Number(m[1]) : undefined;
}

async function github(repo: string): Promise<number | undefined> {
  let total = 0;
  for (let page = 1; page < 10; page++) {
    const r = await fetchImpl(`https://api.github.com/repos/salty-max/${repo}/releases?per_page=100&page=${page}`, {
      headers: { ...UA, Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return undefined;
    const releases = (await r.json()) as { assets: { download_count: number }[] }[];
    for (const rel of releases) for (const a of rel.assets) total += a.download_count;
    if (releases.length < 100) break;
  }
  return total;
}

const settle = async <T>(p: Promise<T>) => p.catch(() => undefined);

export async function downloads(): Promise<NonNullable<Day["downloads"]>> {
  const out: NonNullable<Day["downloads"]> = {};
  await Promise.all(
    ADDONS.map(async ([name, cf, slug, wid, repo]) => {
      const [c, w, g] = await Promise.all([
        cf ? settle(curseforge(cf)) : undefined,
        slug && wid ? settle(wago(slug, wid)) : undefined,
        settle(github(repo)),
      ]);
      out[name] = { ...(c !== undefined && { curseforge: c }), ...(w !== undefined && { wago: w }), ...(g !== undefined && { github: g }) };
    }),
  );
  return out;
}

// ── the sites' traffic (Vercel Web Analytics) ────────────────────────────────
/** STATS_SITES: "hearthtale=prj_…,wow-locker=prj_…"; VERCEL_TEAM_ID: their team. */
async function traffic(day: string): Promise<Day["traffic"]> {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  const team = process.env.VERCEL_TEAM_ID;
  if (!token || !team) return undefined;
  const out: NonNullable<Day["traffic"]> = {};
  for (const pair of (process.env.STATS_SITES ?? "").split(",").filter(Boolean)) {
    const [name, project] = pair.split("=");
    const q = new URLSearchParams({ teamId: team, projectId: project, since: day, until: day, by: "day" });
    const r = await settle(
      fetchImpl(`https://api.vercel.com/v1/query/web-analytics/visits/aggregate?${q}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      }),
    );
    if (!r?.ok) {
      // (in the function's logs: why a site's numbers are missing)
      console.error(JSON.stringify({ traffic: name, status: r?.status ?? "no answer", body: r ? (await r.text()).slice(0, 300) : "" }));
      continue;
    }
    const rows = ((await r.json()) as { data?: { pageviews: number; visitors: number }[] }).data ?? [];
    out[name] = rows.reduce((a, x) => ({ pageviews: a.pageviews + x.pageviews, visitors: a.visitors + x.visitors }), { pageviews: 0, visitors: 0 });
  }
  return out;
}

// ── each addon's standing on CurseForge (its official API) ──────────────────
async function standing(): Promise<Day["curseforge"]> {
  const key = process.env.CURSEFORGE_API_KEY;
  if (!key) return undefined;
  const ids = ADDONS.filter(([, cf]) => cf).map(([name, cf]) => [name, cf!] as const);
  const r = await settle(
    fetchImpl("https://api.curseforge.com/v1/mods", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ modIds: ids.map(([, id]) => id) }),
      signal: AbortSignal.timeout(20_000),
    }),
  );
  if (!r?.ok) {
    console.error(JSON.stringify({ curseforge: "standing", status: r?.status ?? "no answer" }));
    return undefined;
  }
  const mods = ((await r.json()) as { data?: { id: number; gamePopularityRank?: number; favoriteCount?: number; thumbsUpCount?: number }[] }).data ?? [];
  const out: NonNullable<Day["curseforge"]> = {};
  for (const [name, id] of ids) {
    const m = mods.find((x) => x.id === id);
    if (m) out[name] = { rank: m.gamePopularityRank, favorites: m.favoriteCount, likes: m.thumbsUpCount };
  }
  return out;
}

// ── the daily job ────────────────────────────────────────────────────────────
/** Yesterday's pings, counts and traffic, today's download totals, into the history. */
export async function collect(now = new Date()): Promise<History> {
  const day = yesterday(now);
  const pings = await store.all(`pings/${day}/`);
  const ravenpost: NonNullable<Day["ravenpost"]> = { installs: 0, versions: {}, os: {}, linked: {}, sharing: 0 };
  for (const name of pings) {
    const p = JSON.parse((await store.read(name)) ?? "null") as Omit<Ping, "id"> | null;
    if (!p) continue;
    ravenpost.installs++;
    bump(ravenpost.versions, p.version);
    bump(ravenpost.os, p.os);
    for (const l of p.linked) bump(ravenpost.linked, l);
    if (p.sharing > 0) ravenpost.sharing++;
  }
  const counts = await store.all(`counts/${day}/`);
  const sharing: NonNullable<Day["sharing"]> = { sharers: 0, uploads: 0, facts: 0, games: {}, locales: {} };
  for (const name of counts) {
    const c = JSON.parse((await store.read(name)) ?? "null") as Count | null;
    if (!c) continue;
    sharing.sharers++;
    sharing.uploads += c.uploads;
    sharing.facts += c.facts;
    for (const [g, n] of Object.entries(c.games)) bump(sharing.games, g, n);
    for (const [l, n] of Object.entries(c.locales)) bump(sharing.locales, l, n);
  }
  const [dl, tr, cf] = await Promise.all([downloads(), traffic(day), standing()]);
  // (run again the same day: what was counted stays, the files being gone)
  const had = (await history()).days[day];
  const kept = {
    ravenpost: pings.length || !had?.ravenpost ? ravenpost : had.ravenpost,
    sharing: counts.length || !had?.sharing ? sharing : had.sharing,
  };
  const h = await record({ [day]: { ...kept, ...(tr && { traffic: tr }) }, [dayOf(now)]: { downloads: dl, downloadsAt: now.toISOString(), ...(cf && { curseforge: cf }) } });
  await store.remove([...pings, ...counts]);
  return h;
}
