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
const PERIODS = ["7", "30", "90"];
const nameOf = new Map(projects.map(([name, id]) => [String(id), name]));
const ids = projects.map(([, id]) => id).join(",");

export class SessionExpired extends Error {}
/** An error whose words are safe to log: none carries the cookie. */
class Said extends Error {}

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
      headers: { cookie: cookie.replace(/[\r\n]+/g, "").trim().replace(/^cookie:\s*/i, ""), accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ project_ids: ids, ...body }),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    // (a turned-down session may answer with a redirect to the sign-in page, or a page of HTML)
    if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) throw new SessionExpired(`CurseForge said ${r.status}`);
    if (!r.ok) throw new Said(`CurseForge said ${r.status} to query ${n}`);
    if (!(r.headers.get("content-type") ?? "").includes("json")) throw new SessionExpired("CurseForge answered a page, not data");
    return ((await r.json()) as { queryResult?: { data?: T[] } }).queryResult?.data ?? [];
  };
  const days: Record<string, UniqueCounts> = {};
  const [downloads, unique, ...rows4] = await Promise.all([
    query<DayRow>(2, { days_back: "90" }),
    query<DayRow>(3, { days_back: "90" }),
    ...PERIODS.map((p) => query<{ projectId: number; total: number; unique: number }>(4, { days_back: p })),
  ]);
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
  PERIODS.forEach((p, i) => {
    const rows = rows4[i];
    periods[p] = Object.fromEntries(rows.filter((r) => nameOf.has(String(r.projectId))).map((r) => [nameOf.get(String(r.projectId))!, { downloads: r.total, unique: r.unique }]));
  });
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
      try {
        await launch.watch([{ id: "unique-cookie", level: "warn", title: "CurseForge turned the session down", line: "The unique downloaders stop here until CURSEFORGE_COOKIE on Vercel is a fresh copy of the authors site's cookie." }], now);
      } catch (e) {
        console.error(JSON.stringify({ unique: "told nobody", err: e instanceof Error ? e.name : "error" }));
      }
      return "expired";
    }
    // (never String(err) of a fetch made with the cookie: a header error quotes its value)
    console.error(JSON.stringify({ unique: "failed", err: err instanceof Said ? err.message : err instanceof Error ? err.name : "error" }));
    return "failed";
  }
}
