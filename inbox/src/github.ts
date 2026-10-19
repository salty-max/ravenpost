import type { Event } from "./events";
import * as store from "./store";

/**
 * Whether a problem the activity told is still one, in GitHub's own words:
 * asked when the dashboard is opened and at each ten-minute look. A pull
 * request waiting for a hand is done once merged or closed; a failed run once
 * it passed on a re-run, or a later run of its workflow on its branch passed.
 * Kept in events/resolved.json (its link: when, how), so a problem settled is
 * never asked again, and the events' own file is never written twice at once.
 * GITHUB_TOKEN when set (without it, GitHub answers 60 requests an hour from
 * an address Vercel shares); no answer leaves the problem as it was.
 */
export type Resolution = { at: string; how: "merged" | "closed" | "passed" };

const FILE = "events/resolved.json";
const PR = /^https:\/\/github\.com\/salty-max\/([\w.-]+)\/pull\/(\d+)$/;
const RUN = /^https:\/\/github\.com\/salty-max\/([\w.-]+)\/actions\/runs\/(\d+)$/;
const AGAIN = 2 * 60_000;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setGitHubFetch = (f: FetchFn) => {
  fetchImpl = f;
};

// (when each open problem was last asked, on this instance: a refresh every
// half minute never asks GitHub every half minute)
const asked = new Map<string, number>();
export const forgetAsked = () => asked.clear();

/** A failure or a wait GitHub can say more about. */
export const checkable = (e: Event) => (e.kind === "failed" || e.kind === "waiting") && !!e.url && (PR.test(e.url) || RUN.test(e.url));

export async function resolutions(): Promise<Record<string, Resolution>> {
  return JSON.parse((await store.read(FILE)) ?? "{}") as Record<string, Resolution>;
}

async function gh<T>(path: string): Promise<T | null> {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ravenpost-inbox",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    console.error(JSON.stringify({ github: path, status: res.status }));
    return null;
  }
  return (await res.json()) as T;
}

type Run = { id: number; conclusion: string | null; workflow_id: number; head_branch: string; created_at: string; updated_at: string };

/** One link's state now: settled (how, when), or null while it's still a problem or GitHub won't say. */
export async function check(url: string): Promise<Resolution | null> {
  const pr = url.match(PR);
  if (pr) {
    const p = await gh<{ state: string; merged_at: string | null; closed_at: string | null }>(`/repos/salty-max/${pr[1]}/pulls/${pr[2]}`);
    if (!p || p.state !== "closed") return null;
    return p.merged_at ? { at: p.merged_at, how: "merged" } : { at: p.closed_at ?? new Date().toISOString(), how: "closed" };
  }
  const r = url.match(RUN);
  if (!r) return null;
  const run = await gh<Run>(`/repos/salty-max/${r[1]}/actions/runs/${r[2]}`);
  if (!run) return null;
  if (run.conclusion === "success") return { at: run.updated_at, how: "passed" };
  // (the workflow's newest finished run on the same branch: passed since, or still failing)
  const q = new URLSearchParams({ branch: run.head_branch, status: "completed", per_page: "1" });
  const later = (await gh<{ workflow_runs?: Run[] }>(`/repos/salty-max/${r[1]}/actions/workflows/${run.workflow_id}/runs?${q}`))?.workflow_runs?.[0];
  if (later && later.id !== run.id && later.conclusion === "success" && later.created_at > run.created_at) return { at: later.updated_at, how: "passed" };
  return null;
}

/**
 * The listed events' problems still open asked again (each at most every two
 * minutes, all at once, `wait` milliseconds at most), the settled ones saved:
 * every resolution known, for the dashboard. The links no event holds any
 * more go from the file.
 */
export async function settle(list: Event[], opts: { known?: Record<string, Resolution>; wait?: number; now?: number } = {}): Promise<Record<string, Resolution>> {
  const now = opts.now ?? Date.now();
  const known = opts.known ?? (await resolutions());
  const open = [...new Set(list.filter((e) => checkable(e) && !known[e.url!]).map((e) => e.url!))].filter((u) => now - (asked.get(u) ?? 0) >= AGAIN);
  if (!open.length) return known;
  for (const u of open) asked.set(u, now);
  const found: Record<string, Resolution> = {};
  const asking = Promise.all(
    open.map(async (u) => {
      const r = await check(u).catch(() => null);
      if (r) found[u] = r;
    }),
  );
  await Promise.race([asking, new Promise((done) => setTimeout(done, opts.wait ?? 2500))]);
  if (!Object.keys(found).length) return known;
  const links = new Set(list.map((e) => e.url).filter(Boolean));
  const all = Object.fromEntries(Object.entries({ ...(await resolutions()), ...found }).filter(([u]) => links.has(u)));
  await store.write(FILE, JSON.stringify(all));
  return all;
}
