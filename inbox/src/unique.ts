/**
 * Each addon's unique downloaders on CurseForge: its downloads and its
 * different people a day (the last 90 days) and over the last 7, 30 and 90,
 * CurseForge's own statistics. They sit behind the owner's author session
 * (authors.curseforge.com/_api/statistics-new/queries/<n>, read on 19 October
 * 2026: 2 the downloads a day by project, 3 the unique downloaders a day, 4
 * both over a period), so the cron reads them with CURSEFORGE_COOKIE, once an
 * hour. When CurseForge turns the session down, one warning is told (once a
 * day) to paste a fresh cookie; the last numbers stay. bin/curseforge-unique.ts
 * reads them the same way from a computer, should the cookie not be set here.
 */
import { ADDONS, readUnique, recordUnique, type UniqueCounts } from "./stats";
import * as launch from "./launch";

const API = "https://authors.curseforge.com/_api/statistics-new/queries";
const projects = ADDONS.filter(([, cf]) => cf).map(([name, cf]) => [name, cf!] as const);
const nameOf = new Map(projects.map(([name, id]) => [String(id), name]));
const ids = projects.map(([, id]) => id).join(",");

export class SessionExpired extends Error {}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setUniqueFetch = (f: FetchFn) => {
  fetchImpl = f;
};

type DayRow = { day: number | null } & Record<string, number | null>;

/** What CurseForge's statistics say, in the shape /api/unique takes. */
export async function readFromCurseForge(cookie: string): Promise<{ days: Record<string, UniqueCounts>; periods: Record<string, UniqueCounts> }> {
  const query = async <T>(n: number, body: Record<string, string>): Promise<T[]> => {
    const r = await fetchImpl(`${API}/${n}`, {
      method: "POST",
      headers: { cookie: cookie.trim().replace(/^cookie:\s*/i, ""), accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ project_ids: ids, ...body }),
      signal: AbortSignal.timeout(25_000),
    });
    if (r.status === 401 || r.status === 403) throw new SessionExpired(`CurseForge said ${r.status}`);
    if (!r.ok) throw new Error(`CurseForge said ${r.status} to query ${n}`);
    return ((await r.json()) as { queryResult?: { data?: T[] } }).queryResult?.data ?? [];
  };
  const days: Record<string, UniqueCounts> = {};
  const [downloads, unique] = await Promise.all([query<DayRow>(2, { days_back: "90" }), query<DayRow>(3, { days_back: "90" })]);
  for (const [rows, field] of [
    [downloads, "downloads"],
    [unique, "unique"],
  ] as const) {
    for (const row of rows) {
      if (!row.day) continue;
      const d = new Date(row.day).toISOString().slice(0, 10);
      for (const [id, name] of nameOf) {
        const c = (days[d] ??= {})[name] ?? { downloads: 0, unique: 0 };
        c[field] = Number(row[id] ?? 0);
        days[d][name] = c;
      }
    }
  }
  const periods: Record<string, UniqueCounts> = {};
  for (const p of ["7", "30", "90"]) {
    const rows = await query<{ projectId: number; total: number; unique: number }>(4, { days_back: p });
    periods[p] = Object.fromEntries(rows.filter((r) => nameOf.has(String(r.projectId))).map((r) => [nameOf.get(String(r.projectId))!, { downloads: r.total, unique: r.unique }]));
  }
  return { days, periods };
}

/** The hourly look: read, check, keep. "skipped" without a cookie; an expired one is told once a day. */
export async function lookUnique(now = new Date()): Promise<"read" | "skipped" | "expired" | "failed"> {
  const cookie = process.env.CURSEFORGE_COOKIE;
  if (!cookie) return "skipped";
  try {
    const u = readUnique(await readFromCurseForge(cookie));
    if (!u) return "failed";
    await recordUnique(u, now);
    return "read";
  } catch (err) {
    if (err instanceof SessionExpired) {
      await launch.watch([{ id: "unique-cookie", level: "warn", title: "CurseForge turned the session down", line: "The unique downloaders stop here until CURSEFORGE_COOKIE on Vercel is a fresh copy of the authors site's cookie." }], now);
      return "expired";
    }
    console.error(JSON.stringify({ unique: "failed", err: String(err) }));
    return "failed";
  }
}
