import type { Reading, Release } from "./curseforge";
import type { Event } from "./events";
import type { Resolution } from "./github";
import { behind, type GitHubRelease } from "./launch";
import { ADDONS, type Day, type History, type Today } from "./stats";

/**
 * The dashboard's numbers, apart from how they are drawn: the daily series
 * (`seriesOf`), the 24 hours (`hourlyOf`), how things stand (`standing`), the
 * overview's figures, each addon's rank and release. Pure functions of the
 * inbox's stored data. The old page (dashboard.ts) draws them as HTML and the
 * owner API (owner.ts) hands them out as JSON: one set of arithmetic for both.
 */
export const sum = (o: Record<string, number | undefined> | undefined) => Object.values(o ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
export const DAY = 86_400_000;

/** A view of the history with the ten-minute looks' latest counts (CurseForge,
 * Wago, GitHub), retaining each store's most recent count. The daily history
 * stays untouched. */
export function withDownloadReadings(h: History, readings: Reading[]): History {
  const days = { ...h.days };
  const known: Record<string, { day: string; at?: string; channels: NonNullable<Day["downloads"]>[string] }> = {};
  for (const day of Object.keys(h.days).sort()) {
    for (const [addon, channels] of Object.entries(h.days[day].downloads ?? {})) {
      known[addon] = { day, at: h.days[day].downloadsAt, channels: { ...known[addon]?.channels, ...channels } };
    }
  }
  const fine = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  for (const [at, totals, others] of [...readings].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!Number.isFinite(Date.parse(at))) continue;
    const day = at.slice(0, 10);
    const fresh: Record<string, NonNullable<Day["downloads"]>[string]> = {};
    for (const [addon, count] of Object.entries(totals)) if (fine(count)) fresh[addon] = { curseforge: count };
    for (const [addon, o] of Object.entries(others ?? {}))
      for (const ch of ["wago", "github"] as const) if (fine(o?.[ch])) fresh[addon] = { ...fresh[addon], [ch]: o[ch] };
    for (const [addon, f] of Object.entries(fresh)) {
      if (known[addon] && day < known[addon].day) continue;
      if (known[addon]?.at && Date.parse(at) <= Date.parse(known[addon].at!)) continue;
      const channels = { ...known[addon]?.channels, ...f };
      known[addon] = { day, at, channels };
      days[day] = { ...days[day], downloads: { ...days[day]?.downloads, [addon]: channels } };
    }
  }
  return { ...h, days };
}

// ── the numbers, as the page draws them ──────────────────────────────────────
export type N = number | null;
export type Store = "curseforge" | "wago" | "github";
export type Series = {
  days: string[];
  downloads: {
    addons: string[];
    daily: Record<string, N[]>;
    since: (string | null)[];
    totals: Record<string, number>;
    channels: Record<string, NonNullable<Day["downloads"]>[string]>;
    week: Record<string, number | null>;
    /** The days before any total was counted, filled from CurseForge's own daily count (its statistics), every other store unknown there. */
    early: boolean[];
    /** New downloads a day by store, every addon together. */
    stores: Record<Store, N[]>;
  };
  /** Different people a day by addon (CurseForge's own count, a day or two behind). */
  unique: Record<string, N[]>;
  /** Each addon's rank among every WoW addon on CurseForge, a day. */
  rank: Record<string, N[]>;
  installs: N[];
  /** Different Ravenpost installs over the 7 days to each day. */
  installsWeek: N[];
  facts: N[];
  sharers: N[];
  newFacts: N[];
  sites: Record<string, { visitors: N[]; pageviews: N[] }>;
};

/** CurseForge gives a project it hasn't ranked yet a placeholder near a million (seen in our own
 * numbers in October 2026, e.g. 980,431 and 1,000,000; its API documents no such value): no rank at
 * all. Real ranks of the family's addons run 2k to 30k, far under the cut. */
export const UNRANKED = 100_000;
export const ranked = (r: number | undefined) => (r && r < UNRANKED ? r : undefined);

/** Every calendar day from the first to the last (the last 180), each part's numbers on them; downloads a day as the totals' difference (a gap's shared evenly over its days, said in `since`). */
export function seriesOf(h: History): Series {
  const have = Object.keys(h.days).sort();
  const days: string[] = [];
  if (have.length) {
    const last = Date.parse(have[have.length - 1]);
    const first = Math.max(Date.parse(have[0]), last - 179 * DAY);
    for (let t = first; t <= last; t += DAY) days.push(new Date(t).toISOString().slice(0, 10));
  }
  const at = (d: string) => h.days[d];
  const addons = [...new Set(days.flatMap((d) => Object.keys(at(d)?.downloads ?? {})))];
  const daily: Record<string, N[]> = {};
  const since: (string | null)[] = days.map(() => null);
  const totals: Record<string, number> = {};
  const channels: Series["downloads"]["channels"] = {};
  const week: Record<string, number | null> = {};
  const filled: boolean[] = days.map(() => false);
  let firstCounted = days.length;
  const STORES: Store[] = ["curseforge", "wago", "github"];
  const stores = Object.fromEntries(STORES.map((x) => [x, days.map((): N => null)])) as Record<Store, N[]>;
  const add = (xs: N[], j: number, v: number) => {
    xs[j] = (xs[j] ?? 0) + v;
  };
  for (const a of addons) {
    let prev: { day: string; total: number; i: number; channels: Series["downloads"]["channels"][string] } | null = null;
    let carried: Series["downloads"]["channels"][string] = {};
    const countedTotals = new Map<string, number>();
    const out: N[] = days.map(() => null);
    days.forEach((d, i) => {
      const c = at(d)?.downloads?.[a];
      if (!c) return;
      carried = { ...carried, ...c };
      const total = sum(carried);
      countedTotals.set(d, total);
      totals[a] = total;
      channels[a] = carried;
      if (prev) {
        // (a gap: the difference covers the days since the last count, shared over them)
        const span = i - prev.i;
        const each = Math.max(0, total - prev.total) / span;
        for (let j = prev.i + 1; j <= i; j++) {
          out[j] = each;
          if (span > 1) since[j] = prev.day;
          // (the day's downloads shared by each store's rise: the stores add up to the daily, a store recounted lower counting none)
          const rise = STORES.map((x) => Math.max(0, (carried[x] ?? 0) - (prev!.channels[x] ?? 0)));
          const all = rise.reduce((t, r) => t + r, 0);
          STORES.forEach((x, k) => add(stores[x], j, all ? (each * rise[k]) / all : 0));
        }
      }
      prev = { day: d, total, i, channels: carried };
    });
    // (before the first difference: CurseForge's own count of the day, from its statistics, where it has one)
    const first = out.findIndex((v) => v !== null);
    if (first >= 0) firstCounted = Math.min(firstCounted, first);
    for (let j = 0; j < (first < 0 ? days.length : first); j++) {
      const own = at(days[j])?.unique?.[a]?.downloads;
      if (own === undefined) continue;
      out[j] = own;
      filled[j] = true;
      add(stores.curseforge, j, own);
    }
    daily[a] = out;
    const counted = days.filter((d) => at(d)?.downloads?.[a]);
    const last = counted[counted.length - 1];
    const cut = last ? new Date(Date.parse(last) - 7 * DAY).toISOString().slice(0, 10) : "";
    const base = [...counted].reverse().find((d) => d <= cut) ?? (counted.length > 1 ? counted[0] : undefined);
    week[a] = base && last && base !== last ? totals[a] - countedTotals.get(base)! : null;
  }
  addons.sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  // (CurseForge alone only before any addon's first counted difference: a newer addon's own early days sit among full ones)
  const early = filled.map((f, j) => f && j < firstCounted);
  const uniqueAddons = [...new Set(days.flatMap((d) => Object.keys(at(d)?.unique ?? {})))];
  const unique = Object.fromEntries(uniqueAddons.map((a) => [a, days.map((d) => (at(d)?.unique ? (at(d)!.unique![a]?.unique ?? 0) : null))]));
  const siteNames = [...new Set(days.flatMap((d) => Object.keys(at(d)?.traffic ?? {})))];
  return {
    days,
    downloads: { addons, daily, since, totals, channels, week, early, stores },
    unique,
    rank: Object.fromEntries(
      [...new Set(days.flatMap((d) => Object.keys(at(d)?.curseforge ?? {})))].map((a) => [a, days.map((d) => ranked(at(d)?.curseforge?.[a]?.rank) ?? null)]),
    ),
    installs: days.map((d) => at(d)?.ravenpost?.installs ?? null),
    installsWeek: days.map((d) => at(d)?.ravenpost?.distinct?.week ?? null),
    facts: days.map((d) => at(d)?.sharing?.facts ?? null),
    sharers: days.map((d) => at(d)?.sharing?.sharers ?? null),
    newFacts: days.map((d) => (at(d)?.merged ? sum(Object.fromEntries(Object.entries(at(d)!.merged!).map(([g, m]) => [g, m.newFacts]))) : null)),
    sites: Object.fromEntries(
      siteNames.map((s) => [s, { visitors: days.map((d) => at(d)?.traffic?.[s]?.visitors ?? null), pageviews: days.map((d) => at(d)?.traffic?.[s]?.pageviews ?? null) }]),
    ),
  };
}

/** The last 48 hours from the ten-minute readings (curseforge.ts): new downloads an hour by addon (the page shows the last 24, against the 24 before), an hour's the rise since the reading before; and today's (UTC) so far. */
export function hourlyOf(readings: Reading[], now = Date.now()) {
  const start = Math.floor(now / 3600_000) * 3600_000 - 47 * 3600_000;
  const hours = Array.from({ length: 48 }, (_, i) => new Date(start + i * 3600_000).toISOString());
  const sorted = [...readings].sort((a, b) => a[0].localeCompare(b[0]));
  const addons = [...new Set(sorted.flatMap(([, t]) => Object.keys(t)))];
  const series: Record<string, N[]> = Object.fromEntries(addons.map((a) => [a, hours.map(() => null)]));
  const day = new Date(now).toISOString().slice(0, 10);
  let today: number | null = null;
  for (const a of addons) {
    const counted = sorted.filter(([, t]) => Number.isFinite(t[a]));
    for (let i = 1; i < counted.length; i++) {
      const [at, t] = counted[i];
      const h = Math.floor((Date.parse(at) - start) / 3600_000);
      if (h >= 0 && h < 48) series[a][h] = (series[a][h] ?? 0) + Math.max(0, t[a] - counted[i - 1][1][a]);
    }
    // (the base: yesterday's last reading, never an older day's, which would count days of downloads as today's)
    const base = [...counted].reverse().find(([at]) => at.slice(0, 10) < day && Date.parse(at) >= Date.parse(day) - DAY) ?? counted.find(([at]) => at.slice(0, 10) === day);
    const last = counted[counted.length - 1];
    if (base && last && last[0].slice(0, 10) === day) today = (today ?? 0) + Math.max(0, last[1][a] - base[1][a]);
  }
  return { hours, series, today, readings: sorted.length };
}

export function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The problems still open: failed jobs and pull requests waiting for a hand, one each however often told, none GitHub has seen settled. */
export function openProblems(events: Event[], resolved: Record<string, Resolution> = {}, now = Date.now()) {
  const open = (kind: Event["kind"]) => {
    const seen = new Set<string>();
    return events.filter((e) => {
      if (e.kind !== kind || (e.url && resolved[e.url])) return false;
      const checked = !!e.url && /^https:\/\/github\.com\/salty-max\/[\w.-]+\/(pull|actions\/runs)\/\d+$/.test(e.url);
      if (now - Date.parse(e.at) > (checked ? 7 * DAY : 36 * 3600_000)) return false;
      const key = kind === "waiting" && e.url ? e.url : `${e.repo}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return { failed: open("failed"), waiting: open("waiting") };
}

/**
 * How things stand: a failure first, then a pull request waiting, else quiet.
 * A problem GitHub has seen settled (merged, closed, passed since: github.ts)
 * is none; one GitHub can say nothing of lasts 36 hours, one it can a week
 * while still open. A job failing again, or a pull request told each day,
 * counts once.
 */
export function standing(events: Event[], resolved: Record<string, Resolution> = {}, now = Date.now()) {
  const { failed, waiting } = openProblems(events, resolved, now);
  if (failed.length) return { tone: "blood" as const, icon: "x" as const, title: failed.length > 1 ? `${failed.length} jobs failed` : "A job failed", line: failed.map((e) => e.title).join(" · ") };
  if (waiting.length) return { tone: "gold" as const, icon: "clock" as const, title: waiting.length > 1 ? `${waiting.length} things wait for you` : "Something waits for you", line: waiting.map((e) => e.title).join(" · ") };
  const last = events.find((e) => e.kind !== "digest");
  return { tone: "ok" as const, icon: "check" as const, title: "All quiet", line: last ? `Last word ${ago(last.at, now)}: ${last.title}` : "The data jobs report here each morning." };
}

export const lastOf = (xs: N[]) => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return xs[i];
  return null;
};

// ── what the overview adds up (the page's top, its four figures) ──────────────
/** The history with the day's visitors so far, and the ten-minute readings' downloads: the figures of the overview and the series under them. */
export function overviewOf(h: History, opts: { today?: Today | null; readings?: Reading[] }) {
  const td = opts.today ?? null;
  // (the day's visitors so far, from the ten-minute look, on the day the daily job has not summed yet)
  const live = td?.traffic ? { ...h, days: { ...h.days, [td.day]: { ...h.days[td.day], traffic: td.traffic } } } : h;
  const s = seriesOf(withDownloadReadings(live, opts.readings ?? []));
  const total = Object.values(s.downloads.totals).reduce((a, b) => a + b, 0);
  const weeks = Object.values(s.downloads.week).filter((v): v is number => v !== null);
  const week = weeks.length ? weeks.reduce((a, b) => a + b, 0) : null;
  // (the KPI and its spark are whole days: today's visitors so far are told beside, as the other cards do)
  const visitorsToday = td?.traffic ? Object.values(td.traffic).reduce((a, x) => a + x.visitors, 0) : null;
  const visitors = s.days.map((d, i) => {
    if (td?.traffic && d === td.day) return null;
    const vs = Object.values(s.sites).map((x) => x.visitors[i]).filter((v): v is number => v !== null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
  });
  const lastDay = s.days.at(-1);
  const latest = <K extends keyof Day>(k: K): Day[K] | undefined => {
    const all = Object.keys(h.days).sort();
    for (let i = all.length - 1; i >= 0; i--) if (h.days[all[i]]?.[k]) return h.days[all[i]][k];
    return undefined;
  };
  const rp = latest("ravenpost");
  // (different installs to today when the ten-minute look counted them, else to the daily job's last day)
  const rpDay = Object.keys(h.days).sort().reverse().find((d) => h.days[d]?.ravenpost);
  const [distinct, distinctTo] = td?.distinct ? [td.distinct, td.day] : [rp?.distinct, rp?.distinct ? rpDay : undefined];
  const sh = latest("sharing");
  const hourly = hourlyOf(opts.readings ?? []);
  const downloadsChecked = [...(opts.readings ?? [])].map(([at]) => at).sort().at(-1);
  return { td, s, total, week, visitorsToday, visitors, lastDay, rp, distinct, distinctTo, sh, hourly, downloadsChecked };
}

// ── each addon's standing on CurseForge ──────────────────────────────────────
/** Each addon with a CurseForge project: its rank and the rank a week before, its favorites and newest release, ranked first. `base` is the day the move is measured from. */
export function standingRows(h: History, releases: Record<string, Release[]>) {
  const days = Object.keys(h.days).filter((d) => h.days[d]?.curseforge).sort();
  const last = days.at(-1);
  const cut = last ? new Date(Date.parse(last) - 7 * DAY).toISOString().slice(0, 10) : "";
  const base = [...days].reverse().find((d) => d <= cut) ?? (days.length > 1 ? days[0] : undefined);
  const cfNow = last ? h.days[last].curseforge! : {};
  const cfWas = base ? h.days[base].curseforge! : {};
  const rows = ADDONS.filter(([, cf]) => cf)
    // (seen: read unranked since the week's first day, on it or after, so a newly ranked project is "new")
    .map(([name]) => ({ name, rank: ranked(cfNow[name]?.rank), was: ranked(cfWas[name]?.rank), seen: days.some((d) => (!base || d >= base) && d !== last && !!h.days[d].curseforge![name] && !ranked(h.days[d].curseforge![name].rank)), fav: cfNow[name]?.favorites, r: releases[name]?.[0] }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name));
  return { rows, base };
}

// ── each addon's newest release on the stores, and its last data job ─────────
/** Every addon's GitHub release, CurseForge release (and whether CurseForge was read for it), last data job, and how far CurseForge is behind GitHub. */
export function addonStatus(gh: Record<string, GitHubRelease>, cf: Record<string, Release[]>, events: Event[], now = Date.now()) {
  return ADDONS.map(([name, , , , repo]) => ({
    name,
    repo,
    hasCurseForge: !!ADDONS.find((a) => a[4] === repo)?.[1],
    read: !!cf[name],
    github: gh[name] as GitHubRelease | undefined,
    curseforge: cf[name]?.[0] as Release | undefined,
    job: events.find((e) => e.repo === repo && (e.kind === "merged" || e.kind === "failed" || e.kind === "waiting")),
    behind: behind(gh[name], cf[name], now),
  }));
}

/** The releases to mark on the chart: CurseForge's for the addons, GitHub's newest for Ravenpost; only those on a day the series has. */
export function marksOf(days: string[], releases: Record<string, Release[]>, github: Record<string, GitHubRelease>) {
  return [
    ...Object.entries(releases).flatMap(([a, rs]) => rs.map((r) => ({ day: r.at.slice(0, 10), addon: a, text: `${a} ${r.version}` }))),
    ...Object.entries(github)
      .filter(([a]) => !ADDONS.find((x) => x[0] === a)?.[1])
      .map(([a, g]) => ({ day: g.at.slice(0, 10), addon: a, text: `${a} ${g.tag.replace(/^v/, "")}` })),
  ].filter((m) => days.includes(m.day));
}
