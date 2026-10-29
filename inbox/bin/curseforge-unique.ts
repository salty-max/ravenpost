/**
 * Each addon's unique downloaders on CurseForge, brought to the dashboard:
 * its downloads and its different people a day (the last 90 days) and over
 * the last 7, 30 and 90 days, CurseForge's own statistics. They sit behind
 * the owner's session (its authors' site, the Downloads statistics page's own
 * queries: authors.curseforge.com/_api/statistics-new/queries/<n>, read on 19
 * October 2026: 2 the downloads a day by project, 3 the unique downloaders a
 * day, 4 both over a period), so the inbox's cron reads them (src/unique.ts,
 * CURSEFORGE_COOKIE on Vercel, hourly); this reads them from a computer
 * instead, should that cookie not be set there, and hands them to the inbox
 * (POST /api/unique).
 *
 *   bun bin/curseforge-unique.ts          read and hand over
 *   bun bin/curseforge-unique.ts --dry    read and show, nothing sent
 *
 * The session: the cookie addon-kit's store.ts uses
 * (~/.config/wow-addons/curseforge-cookie, or CURSEFORGE_COOKIE); the
 * inbox's token for it, its alone: UNIQUE_TOKEN, or
 * ~/.config/wow-addons/unique-token (the inbox's UNIQUE_TOKEN); INBOX_URL, else
 * https://ravenpost-inbox.vercel.app. CurseForge's numbers are a day or two
 * behind; each run replaces the days it reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ADDONS } from "../src/stats";
import { readFromCurseForge } from "../src/unique";

const CONFIG = join(homedir(), ".config", "wow-addons");
const secret = (env: string, file: string, what: string) => {
  if (process.env[env]) return process.env[env]!.trim();
  const f = join(CONFIG, file);
  if (existsSync(f)) return readFileSync(f, "utf8").trim().replace(/^cookie:\s*/i, "");
  throw new Error(`no ${what}: ${env}, or the file ${f}`);
};

const projects = ADDONS.filter(([, cf]) => cf).map(([name, cf]) => [name, cf!] as const);
const { days, periods } = await readFromCurseForge(secret("CURSEFORGE_COOKIE", "curseforge-cookie", "CurseForge session"));

const sorted = Object.keys(days).sort();
console.log(`CurseForge: ${sorted.length} days, ${sorted[0] ?? "–"} to ${sorted.at(-1) ?? "–"}`);
for (const [name] of projects) {
  const c = (p: string) => periods[p]?.[name];
  console.log(`  ${name.padEnd(20)} 7 d ${c("7")?.unique ?? "–"} of ${c("7")?.downloads ?? "–"} · 30 d ${c("30")?.unique ?? "–"} of ${c("30")?.downloads ?? "–"} · 90 d ${c("90")?.unique ?? "–"} of ${c("90")?.downloads ?? "–"}`);
}
if (process.argv.includes("--dry")) process.exit(0);

const inbox = (process.env.INBOX_URL || "https://ravenpost-inbox.vercel.app").replace(/\/$/, "");
const res = await fetch(`${inbox}/api/unique`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${secret("UNIQUE_TOKEN", "unique-token", "inbox token")}` },
  body: JSON.stringify({ days, periods }),
});
if (!res.ok) throw new Error(`the inbox said ${res.status}: ${(await res.text()).slice(0, 200)}`);
console.log(`handed to the inbox: ${JSON.stringify(await res.json())}`);
