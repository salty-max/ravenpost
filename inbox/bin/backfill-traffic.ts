/**
 * The sites' visitors and page views for the days before the inbox counted
 * them (the daily job began on 15 October 2026), from Vercel Web Analytics,
 * handed to the inbox's history (POST /api/inbox/stats: each day's traffic
 * part replaced, the rest of the day kept). Once, by hand: Web Analytics
 * keeps a limited past (its plan's), an older day answers nothing and is left
 * out.
 *
 *   bun bin/backfill-traffic.ts                 2026-08-01 to 2026-10-13, handed over
 *   bun bin/backfill-traffic.ts --dry           the same, shown, nothing sent
 *   bun bin/backfill-traffic.ts --from 2026-09-01 --to 2026-10-13
 *
 * The same environment as the daily job's traffic (VERCEL_ANALYTICS_TOKEN,
 * VERCEL_TEAM_ID, STATS_SITES: `vercel env pull` from inbox/ writes them to
 * .env.local, which Bun loads), INBOX_TOKEN for the inbox (wow-data's), and
 * INBOX_URL, else https://ravenpost-inbox.vercel.app.
 */
import { traffic, type Day } from "../src/stats";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const from = arg("--from", "2026-08-01");
const to = arg("--to", "2026-10-13");
if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) || from > to) throw new Error("--from and --to: YYYY-MM-DD, the first not after the second");
if (!process.env.VERCEL_ANALYTICS_TOKEN || !process.env.VERCEL_TEAM_ID || !process.env.STATS_SITES)
  throw new Error("VERCEL_ANALYTICS_TOKEN, VERCEL_TEAM_ID and STATS_SITES: `vercel env pull` from inbox/");

const days: Record<string, Day> = {};
for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10);
  const tr = await traffic(day);
  // (a day before the sites existed, or past what Analytics keeps: nothing to bring)
  if (!tr || !Object.values(tr).some((s) => s.pageviews || s.visitors)) continue;
  days[day] = { traffic: tr };
  console.log(`${day}  ${Object.entries(tr).map(([s, v]) => `${s} ${v.visitors} visitors, ${v.pageviews} views`).join(" · ")}`);
}
console.log(`${Object.keys(days).length} days with traffic, ${from} to ${to}`);
if (process.argv.includes("--dry") || !Object.keys(days).length) process.exit(0);

if (!process.env.INBOX_TOKEN) throw new Error("INBOX_TOKEN: the inbox's, wow-data's");
const inbox = (process.env.INBOX_URL || "https://ravenpost-inbox.vercel.app").replace(/\/$/, "");
const res = await fetch(`${inbox}/api/inbox/stats`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.INBOX_TOKEN}` },
  body: JSON.stringify({ days }),
});
if (!res.ok) throw new Error(`the inbox said ${res.status}: ${(await res.text()).slice(0, 200)}`);
console.log(`handed to the inbox: ${JSON.stringify(await res.json())}`);
