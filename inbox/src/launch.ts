import * as push from "./push";
import { ADDONS, dayOf, type History, type Today } from "./stats";
import * as store from "./store";
import type { Release } from "./curseforge";

/**
 * The launch watch and the addons' standing, for the dashboard (its Addons
 * section) and the owner's phone:
 *
 * - every look (/api/cron/curseforge, with GitHub's hourly rate) each addon's
 *   latest GitHub release, kept in releases/github.json;
 * - `checks`: what a launch day needs watching, from numbers the inbox already
 *   has: Ravenpost's pings and the sharers' uploads against yesterday's (judged
 *   after 18:00 UTC, when a day is mostly in), a day's installs doubling (good
 *   news), a release on GitHub that CurseForge still hasn't passed after six
 *   hours (its review can take that long: a prerelease never counts, so the
 *   flip to prerelease also stops this);
 * - `watch`: the warnings and the good news told once to the owner's devices
 *   (alerts/told.json: each key at most once a day), not into the activity:
 *   a problem told there stays until GitHub says it's settled, and these
 *   settle by themselves.
 */
export type GitHubRelease = { tag: string; at: string; url: string };
export type Check = { id: string; level: "ok" | "warn" | "good"; title: string; line: string };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setLaunchFetch = (f: FetchFn) => {
  fetchImpl = f;
};

const FILE = "releases/github.json";
const TOLD = "alerts/told.json";
export const DRIFT_HOURS = 6;
const JUDGED_AFTER_HOUR = 18;

export async function githubLatest(): Promise<Record<string, GitHubRelease>> {
  return JSON.parse((await store.read(FILE)) ?? "{}") as Record<string, GitHubRelease>;
}

/** Each addon's latest GitHub release (never a prerelease or a draft); a repository GitHub won't answer for keeps its last. */
export async function lookGitHub(): Promise<Record<string, GitHubRelease>> {
  const kept = await githubLatest();
  await Promise.all(
    ADDONS.map(async ([name, , , , repo]) => {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/salty-max/${repo}/releases/latest`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "ravenpost-inbox", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return;
        const r = (await res.json()) as { tag_name?: string; published_at?: string; html_url?: string };
        if (r.tag_name && r.published_at) kept[name] = { tag: r.tag_name, at: r.published_at, url: r.html_url ?? `https://github.com/salty-max/${repo}/releases` };
      } catch {
        /* (the last one stays) */
      }
    }),
  );
  await store.write(FILE, JSON.stringify(kept));
  return kept;
}

/** "v0.15.0" or "Yonder 0.15.0 (Classic)" as [0, 15, 0], null when no x.y.z is in it. */
export function parts(v: string): [number, number, number] | null {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function newer(a: string, b: string): boolean {
  const x = parts(a), y = parts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** An addon's GitHub release past CurseForge's newest, and for how long: the store waiting on its review. */
export function behind(gh: GitHubRelease | undefined, cf: Release[] | undefined, now = Date.now()): { hours: number } | null {
  if (!gh || !cf?.length) return null;
  const newest = cf.reduce((a, r) => (newer(r.version, a.version) ? r : a));
  if (!newer(gh.tag, newest.version)) return null;
  return { hours: Math.floor((now - Date.parse(gh.at)) / 3_600_000) };
}

const n = (v: number) => v.toLocaleString("en-GB");

export function checks(h: History, today: Today | null, gh: Record<string, GitHubRelease>, cf: Record<string, Release[]>, now = new Date()): Check[] {
  const out: Check[] = [];
  const yday = h.days[dayOf(new Date(now.getTime() - 86_400_000))];
  const late = now.getUTCHours() >= JUDGED_AFTER_HOUR;

  const pings = today?.installs, before = yday?.ravenpost?.installs;
  if (pings !== undefined && before !== undefined && before >= 5) {
    if (late && pings < before / 2) out.push({ id: "pings", level: "warn", title: "Ravenpost pings are down", line: `${n(pings)} installs today against ${n(before)} yesterday.` });
    else if (pings >= Math.max(20, before * 2)) out.push({ id: "spike", level: "good", title: "Ravenpost installs are up", line: `${n(pings)} installs today, ${n(before)} yesterday.` });
    else out.push({ id: "pings", level: "ok", title: "Ravenpost pings", line: `${n(pings)} installs today, ${n(before)} yesterday.` });
  } else out.push({ id: "pings", level: "ok", title: "Ravenpost pings", line: pings === undefined ? "Not counted yet today." : `${n(pings)} installs today.` });

  const sharers = today?.sharers, bs = yday?.sharing?.sharers;
  if (sharers !== undefined && bs !== undefined && bs >= 5) {
    if (late && sharers < bs * 0.4) out.push({ id: "uploads", level: "warn", title: "Shared facts are down", line: `${n(sharers)} sharers today against ${n(bs)} yesterday.` });
    else out.push({ id: "uploads", level: "ok", title: "Shared facts", line: `${n(sharers)} sharers today, ${n(bs)} yesterday.` });
  } else out.push({ id: "uploads", level: "ok", title: "Shared facts", line: sharers === undefined ? "Not counted yet today." : `${n(sharers)} sharers today.` });

  for (const [name, , , , repo] of ADDONS) {
    const b = behind(gh[name], cf[name], now.getTime());
    if (b && b.hours >= DRIFT_HOURS)
      out.push({ id: `drift-${repo}-${gh[name].tag}`, level: "warn", title: `${name} ${gh[name].tag.replace(/^v/, "")} isn't on CurseForge yet`, line: `On GitHub for ${b.hours} h: CurseForge's review is taking its time.` });
  }
  return out;
}

/** The warnings and the good news not told in the last day, told once to the owner's devices. */
export async function watch(list: Check[], now = new Date()): Promise<string[]> {
  const told = JSON.parse((await store.read(TOLD)) ?? "{}") as Record<string, string>;
  const cut = new Date(now.getTime() - 86_400_000).toISOString();
  const kept = Object.fromEntries(Object.entries(told).filter(([, at]) => at > cut));
  const sent: string[] = [];
  for (const c of list.filter((c) => c.level !== "ok" && !kept[c.id])) {
    await push.notify({ title: c.title, body: c.line, url: "/stats#addons", tag: `watch-${c.id}` });
    kept[c.id] = now.toISOString();
    sent.push(c.id);
  }
  if (sent.length || Object.keys(kept).length !== Object.keys(told).length) await store.write(TOLD, JSON.stringify(kept));
  return sent;
}
