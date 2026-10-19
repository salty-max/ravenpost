/**
 * Each addon's unique downloaders on CurseForge, brought to the dashboard:
 * its downloads and its different people a day (the last 90 days) and over
 * the last 7, 30 and 90 days, CurseForge's own statistics. They sit behind
 * the owner's session (its authors' site, the Downloads statistics page's own
 * queries: authors.curseforge.com/_api/statistics-new/queries/<n>, read on 19
 * October 2026: 2 the downloads a day by project, 3 the unique downloaders a
 * day, 4 both over a period), so they're read here, on the owner's computer,
 * never on a server, and handed to the inbox (POST /api/inbox/unique).
 *
 *   bun bin/curseforge-unique.ts          read and hand over
 *   bun bin/curseforge-unique.ts --dry    read and show, nothing sent
 *
 * The session: the cookie addon-kit's store.ts uses
 * (~/.config/wow-addons/curseforge-cookie, or CURSEFORGE_COOKIE); the inbox's
 * token: INBOX_TOKEN, or ~/.config/wow-addons/inbox-token; INBOX_URL, else
 * https://ravenpost-inbox.vercel.app. CurseForge's numbers are a day or two
 * behind; each run replaces the days it reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ADDONS, type UniqueCounts } from "../src/stats";

const API = "https://authors.curseforge.com/_api/statistics-new/queries";
const CONFIG = join(homedir(), ".config", "wow-addons");
const secret = (env: string, file: string, what: string) => {
  if (process.env[env]) return process.env[env]!.trim();
  const f = join(CONFIG, file);
  if (existsSync(f)) return readFileSync(f, "utf8").trim().replace(/^cookie:\s*/i, "");
  throw new Error(`no ${what}: ${env}, or the file ${f}`);
};

const projects = ADDONS.filter(([, cf]) => cf).map(([name, cf]) => [name, cf!] as const);
const nameOf = new Map(projects.map(([name, id]) => [String(id), name]));
const ids = projects.map(([, id]) => id).join(",");

async function query<T>(n: number, body: Record<string, string>): Promise<T[]> {
  const r = await fetch(`${API}/${n}`, {
    method: "POST",
    headers: { cookie: secret("CURSEFORGE_COOKIE", "curseforge-cookie", "CurseForge session"), accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ project_ids: ids, ...body }),
  });
  if (r.status === 401 || r.status === 403) throw new Error(`CurseForge said ${r.status}: the session has expired, copy the cookie again`);
  if (!r.ok) throw new Error(`CurseForge said ${r.status} to query ${n}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { queryResult?: { data?: T[] } }).queryResult?.data ?? [];
}

// (a day's row: { day: ms, "<project id>": n, … }; a project absent had none)
type DayRow = { day: number | null } & Record<string, number | null>;
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

const sorted = Object.keys(days).sort();
console.log(`CurseForge: ${sorted.length} days, ${sorted[0] ?? "–"} to ${sorted.at(-1) ?? "–"}`);
for (const [name] of projects) {
  const c = (p: string) => periods[p]?.[name];
  console.log(`  ${name.padEnd(20)} 7 d ${c("7")?.unique ?? "–"} of ${c("7")?.downloads ?? "–"} · 30 d ${c("30")?.unique ?? "–"} of ${c("30")?.downloads ?? "–"} · 90 d ${c("90")?.unique ?? "–"} of ${c("90")?.downloads ?? "–"}`);
}
if (process.argv.includes("--dry")) process.exit(0);

const inbox = (process.env.INBOX_URL || "https://ravenpost-inbox.vercel.app").replace(/\/$/, "");
const res = await fetch(`${inbox}/api/inbox/unique`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret("INBOX_TOKEN", "inbox-token", "inbox token")}` },
  body: JSON.stringify({ days, periods }),
});
if (!res.ok) throw new Error(`the inbox said ${res.status}: ${(await res.text()).slice(0, 200)}`);
console.log(`handed to the inbox: ${JSON.stringify(await res.json())}`);
