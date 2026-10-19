import type { Event } from "./events";
import type { History } from "./stats";

/**
 * The morning's digest (/api/cron/digest, after the numbers and the data
 * jobs): what the data jobs did since the last digest, and yesterday's
 * numbers, a line each, in words.
 */
export const REPO_NAMES: Record<string, string> = {
  hearthtale: "Hearthtale",
  "lorekeepers-codex": "the Codex",
  yonder: "Yonder",
  "second-wind": "Second Wind",
  keyring: "Keyring",
  palaver: "Palaver",
  mealbook: "Mealbook",
  "wow-data": "wow-data",
  ravenpost: "Ravenpost",
};
const nameOf = (repo?: string) => (repo ? (REPO_NAMES[repo] ?? repo) : "");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const n = (v: number) => v.toLocaleString("en-GB");
const sum = (o: Record<string, number | undefined> | undefined) => Object.values(o ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
const and = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (k: number, one: string, many: string) => `${n(k)} ${k === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function digestOf(h: History, events: Event[], now = new Date()): { title: string; body: string; lines: string[] } {
  const today = now.toISOString().slice(0, 10);
  const yday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const lines: string[] = [];

  // What the data jobs did
  const merged = [...new Set(events.filter((e) => e.kind === "merged").map((e) => nameOf(e.repo) || e.title))];
  const comments = events.filter((e) => e.kind === "comment");
  const releases = events.filter((e) => e.kind === "release").map((e) => e.title.replace(/ is live on CurseForge$/, ""));
  const failed = events.filter((e) => e.kind === "failed");
  const waiting = events.filter((e) => e.kind === "waiting");
  if (merged.length) lines.push(`${cap(`new game data in ${and(merged)}`)}.`);
  for (const f of failed) lines.push(f.title.endsWith(".") ? f.title : `${f.title}.`);
  for (const w of waiting) lines.push(w.title.endsWith(".") ? w.title : `${w.title}.`);
  if (!merged.length && !failed.length && !waiting.length) lines.push("No new game data.");
  if (releases.length) lines.push(`Live on CurseForge: ${and(releases)}.`);
  if (comments.length) {
    const by: Record<string, number> = {};
    for (const c of comments) {
      // (a word for several counts them all)
      const n = Number(c.title.match(/^(\d+) new comments/)?.[1] ?? 1);
      by[nameOf(c.repo) || "an addon"] = (by[nameOf(c.repo) || "an addon"] ?? 0) + n;
    }
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    lines.push(`${plural(total, "new comment", "new comments")} on CurseForge: ${Object.entries(by).map(([a, k]) => `${a} ${k}`).join(", ")}.`);
  }

  // Downloads: today's totals against yesterday's
  const now_ = h.days[today]?.downloads, before = h.days[yday]?.downloads;
  if (now_ && before) {
    const moved = Object.keys(now_)
      .map((a) => [a, sum(now_[a]) - sum(before[a])] as const)
      .filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = moved.reduce((t, [, d]) => t + d, 0);
    lines.push(total ? `${plural(total, "download", "downloads")}: ${moved.slice(0, 3).map(([a, d]) => `${a} +${n(d)}`).join(", ")}.` : "No new downloads.");
  }

  // Yesterday's Ravenpost, sharing and sites
  const day = h.days[yday];
  if (day?.ravenpost) lines.push(`Ravenpost: ${plural(day.ravenpost.installs, "install", "installs")} active, ${n(day.ravenpost.sharing)} sharing.`);
  const newFacts = sum(Object.fromEntries(Object.entries(h.days[today]?.merged ?? {}).map(([g, m]) => [g, m.newFacts])));
  if (day?.sharing?.facts || newFacts)
    lines.push(`Sharing: ${plural(day?.sharing?.facts ?? 0, "fact", "facts")} from ${plural(day?.sharing?.sharers ?? 0, "player", "players")}${newFacts ? `, ${n(newFacts)} new to the database` : ""}.`);
  const sites = Object.entries(day?.traffic ?? {}).filter(([, t]) => t.visitors > 0);
  if (sites.length) lines.push(`Visitors: ${sites.map(([s, t]) => `${s} ${n(t.visitors)}`).join(", ")}.`);

  const d = new Date(`${today}T12:00:00Z`);
  return { title: `Ravenpost · ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`, body: lines.join("\n"), lines };
}
