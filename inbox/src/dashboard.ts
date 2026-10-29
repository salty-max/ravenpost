import { REPO_NAMES } from "./digest";
import type { Thread } from "./comments";
import type { Reading, Release } from "./curseforge";
import type { Event } from "./events";
import type { Resolution } from "./github";
import type { Day, Distinct, History, Today, UniquePeriods } from "./stats";
import { ADDONS } from "./stats";
import { behind, checks, DRIFT_HOURS, type GitHubRelease } from "./launch";

/**
 * The dashboard (/stats), in Ravenpost's window's look (its theme: night
 * stone, the game's gold, Cinzel and Inter, panels with a gold hairline,
 * lucide's icons): how things stand, the numbers with a small chart each,
 * the activity, then each part's charts. The page carries the numbers as
 * JSON (`seriesOf`) and draws the charts itself at the size they're shown,
 * a value under the finger or the mouse. An app too (public/: its manifest,
 * its service worker for the notifications, Ravenpost's raven for its icons).
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (n: number | undefined | null) => (n === undefined || n === null ? "–" : n.toLocaleString("en-GB"));
const sum = (o: Record<string, number | undefined> | undefined) => Object.values(o ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const signed = (n: number) => `${n < 0 ? "−" : "+"}${fmt(Math.abs(n))}`;

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
type N = number | null;
type Store = "curseforge" | "wago" | "github";
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
          for (const x of STORES) add(stores[x], j, Math.max(0, (carried[x] ?? 0) - (prev.channels[x] ?? 0)) / span);
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
      [...new Set(days.flatMap((d) => Object.keys(at(d)?.curseforge ?? {})))].map((a) => [a, days.map((d) => at(d)?.curseforge?.[a]?.rank ?? null)]),
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
    const base = [...counted].reverse().find(([at]) => at.slice(0, 10) < day) ?? counted.find(([at]) => at.slice(0, 10) === day);
    const last = counted[counted.length - 1];
    if (base && last && last[0].slice(0, 10) === day) today = (today ?? 0) + Math.max(0, last[1][a] - base[1][a]);
  }
  return { hours, series, today, readings: sorted.length };
}

// ── the look: Ravenpost's window's theme ─────────────────────────────────────
const STYLE = `
:root{color-scheme:dark;--night:#0b0c10;--stone:#121319;--stone-2:#181a21;--stone-3:#21242d;--edge:#2b2f3a;--edge-gold:#5a4a2a;--parchment:#ece3cf;--dim:#a39b88;--faint:#6f6a5e;--gold:#f2c14e;--gold-soft:#c9a227;--ok:#6fd08c;--blood:#e0634f;--bnet:#148eff;--display:"Cinzel","Trajan Pro",Georgia,serif;--sans:"Inter",ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:calc(16px + env(safe-area-inset-top))}
body{margin:0;overflow-x:clip;background:radial-gradient(1200px 600px at 70% -10%,rgb(242 193 78/.06),transparent 60%),var(--night);color:var(--parchment);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:inherit;text-decoration:none}
/* (on a phone, the status bar's own strip: the page scrolls under the night, never under the clock) */
body::before{content:"";position:fixed;inset:0 0 auto 0;height:env(safe-area-inset-top);background:rgb(11 12 16/.92);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);z-index:40;pointer-events:none}
.title{font-family:var(--display);font-weight:700;letter-spacing:.03em;color:var(--gold);margin:0}
.panel{position:relative;border:1px solid var(--edge);border-radius:12px;background:linear-gradient(180deg,color-mix(in srgb,var(--stone-2) 98%,white 2%),var(--stone));box-shadow:inset 0 1px 0 rgb(255 255 255/.03),inset 0 0 0 1px rgb(242 193 78/.05),0 10px 30px rgb(0 0 0/.35)}
.ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;height:2.25rem;padding:0 .95rem;border-radius:8px;border:1px solid var(--edge);background:linear-gradient(180deg,var(--stone-3),var(--stone-2));color:var(--parchment);font:500 14px var(--sans);cursor:pointer;white-space:nowrap;transition:border-color .15s,filter .15s}
.btn:hover{border-color:var(--edge-gold);filter:brightness(1.12)}.btn:disabled{opacity:.45;cursor:default}
.btn-gold{border-color:#f6d27a;background:linear-gradient(180deg,#f6d27a,#c9a227 60%,#a07a1c);color:#22170a;font-weight:600;text-shadow:0 1px 0 rgb(255 240 200/.35);box-shadow:0 0 18px rgb(242 193 78/.15)}
.btn-bnet{border-color:#4aa8ff;background:linear-gradient(180deg,#2e9bff,#0b6fd6);color:#fff;font-weight:600;height:2.6rem;padding:0 1.3rem}
.btn-ghost{border-color:transparent;background:transparent;color:var(--dim)}
.tag{display:inline-flex;align-items:center;gap:.3rem;height:1.3rem;padding:0 .5rem;border-radius:999px;border:1px solid rgb(255 255 255/.12);color:var(--dim);font-size:11px;font-weight:500;white-space:nowrap}
.tag.ok{border-color:rgb(111 208 140/.35);color:var(--ok)}.tag.blood{border-color:rgb(224 99 79/.4);color:var(--blood)}.tag.gold{border-color:rgb(242 193 78/.35);color:var(--gold)}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px}[hidden]{display:none!important}.sub{color:var(--faint);font-size:12px;margin:2px 0 0}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:rgb(255 255 255/.08);border-radius:999px;border:3px solid transparent;background-clip:padding-box}

/* the frame: a sidebar on a computer, a bar of tabs at the bottom on a phone */
.side{position:fixed;inset:0 auto 0 0;width:224px;display:flex;flex-direction:column;border-right:1px solid var(--edge);background:rgb(18 19 25/.85);backdrop-filter:blur(8px);padding:22px 12px 18px;z-index:10}
.brand{display:flex;align-items:center;gap:12px;padding:0 8px 22px}.brand img{width:40px;height:40px;border-radius:9px;box-shadow:0 0 14px rgb(242 193 78/.25)}
.brand .title{font-size:18px;line-height:1.1}.brand small{display:block;color:var(--faint);font-size:12px}
.nav{display:flex;flex-direction:column;gap:2px}.nav a{display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:9px;color:var(--dim);transition:background .15s,color .15s}
.nav a:hover{background:rgb(255 255 255/.04);color:var(--parchment)}#fresh{color:var(--faint)}.nav a.on{background:rgb(242 193 78/.1);color:var(--gold)}
.side-foot{margin-top:auto;padding:0 10px;font-size:12px;color:var(--faint)}.side-foot p{margin:6px 0 0}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--faint);flex:none}.dot.ok{background:var(--ok)}.dot.blood{background:var(--blood)}.dot.gold{background:var(--gold)}
.pulse{animation:pulse 2s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}
main{margin-left:224px;padding:28px 32px 64px;max-width:1180px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
.top h1{font-size:26px}.top p{margin:4px 0 0;color:var(--dim)}
.seg{display:inline-flex;padding:3px;border:1px solid var(--edge);border-radius:9px;background:rgb(0 0 0/.25)}.seg button{border:0;background:none;color:var(--dim);font:500 12px var(--sans);padding:5px 10px;border-radius:6px;cursor:pointer}.seg button.on{background:var(--stone-3);color:var(--gold)}
section{margin-bottom:22px}.sh{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 12px}.sh h2{font-size:17px}.sh p{margin:0;color:var(--faint);font-size:12px}
.tabs{display:none}

/* how things stand */
.hero{display:flex;align-items:center;gap:16px;padding:18px 20px;margin-bottom:16px}
.hero .raven{position:relative;width:56px;height:56px;flex:none}.hero .raven img{width:56px;height:56px;border-radius:12px}
.hero .raven .badge{position:absolute;right:-5px;bottom:-5px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:2px solid var(--stone);color:var(--night)}
.badge.ok{background:var(--ok)}.badge.blood{background:var(--blood)}.badge.gold{background:var(--gold)}.badge .ic{width:13px;height:13px;stroke-width:3}
.hero h2{font-size:20px}.hero p{margin:3px 0 0;color:var(--dim)}.hero .grow{flex:1;min-width:0}

/* the numbers */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.kpi{padding:14px 16px 10px;display:flex;flex-direction:column;min-width:0}
.kpi .k{display:flex;align-items:center;gap:7px;color:var(--dim);font-size:12px;font-weight:500}.kpi .k .ic{width:14px;height:14px;color:var(--gold-soft)}
.kpi .v{font:600 26px/1.15 var(--sans);margin-top:6px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.kpi .d{font-size:12px;color:var(--faint);margin-top:2px;line-height:1.35;min-height:2.7em}.kpi .d b{color:var(--ok);font-weight:600}
.kpi .spark{height:42px;margin:8px -6px 0}

/* the activity */
.chips{display:flex;gap:6px;flex-wrap:wrap}.chip{border:1px solid var(--edge);background:transparent;color:var(--dim);font:500 12px var(--sans);height:28px;padding:0 11px;border-radius:999px;cursor:pointer}.chip.on{border-color:var(--edge-gold);background:rgb(242 193 78/.1);color:var(--gold)}
.feed{list-style:none;margin:0;padding:6px 0}.feed li{display:flex;gap:12px;padding:12px 18px;border-top:1px solid rgb(255 255 255/.045)}.feed li:first-child{border-top:0}
.feed .i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex:none;margin-top:1px}
.i.merged{background:rgb(111 208 140/.12);color:var(--ok)}.i.failed{background:rgb(224 99 79/.14);color:var(--blood)}.i.waiting,.i.test{background:rgb(242 193 78/.12);color:var(--gold)}.i.digest{background:rgb(108 180 238/.12);color:#6cb4ee}.i.comment{background:rgb(181 140 240/.14);color:#b58cf0}.i.release{background:rgb(242 193 78/.12);color:var(--gold)}
.feed .c{flex:1;min-width:0}.feed .t{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.feed .t b{font-weight:600}.feed .t time{color:var(--faint);font-size:12px;white-space:nowrap}
.feed .b{color:var(--dim);font-size:13px;white-space:pre-line;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}.feed .b.open{display:block}
.feed .m{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}.feed .m a{color:var(--gold);font-size:12px}.feed li.done .i{filter:grayscale(1);opacity:.55}.feed li.done .t b{color:var(--dim)}
.scroll{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.scroll.fade{-webkit-mask-image:linear-gradient(#000 calc(100% - 28px),transparent);mask-image:linear-gradient(#000 calc(100% - 28px),transparent)}.scroll.end{-webkit-mask-image:none;mask-image:none}
.more{display:block;width:100%;border:0;border-top:1px solid rgb(255 255 255/.045);background:none;color:var(--dim);font:500 13px var(--sans);padding:11px;cursor:pointer;border-radius:0 0 12px 12px}.more:hover{color:var(--gold)}
.empty{color:var(--faint);padding:18px;margin:0;font-size:13px}
.thread{padding:14px 18px;border-top:1px solid rgb(255 255 255/.045)}.thread:first-child{border-top:0}
.thread .t{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.thread .t b{font-weight:600}.thread .t time{margin-left:auto;color:var(--faint);font-size:12px}
.thread .x{color:var(--dim);font-size:13px;margin-top:4px;white-space:pre-line}
.thread .r{margin:8px 0 0 14px;padding-left:12px;border-left:2px solid var(--edge);font-size:13px}.thread .r.me{border-left-color:var(--edge-gold)}.thread .r b{font-weight:600;color:var(--parchment)}.thread .r.me b{color:var(--gold)}.thread .r span{color:var(--dim)}
.thread .a{display:flex;gap:10px;align-items:center;margin-top:8px;font-size:12px}.thread .a a{color:var(--gold)}

/* the charts */
.card{padding:16px 18px}.card h3{margin:0;font:600 13px var(--sans);color:var(--parchment)}
body.dl-u [data-mode=all],body:not(.dl-u) [data-mode=unique]{display:none!important}
.periods{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,auto);max-width:620px;margin-top:10px;font-size:12px}.periods>*{padding:8px 0;border-top:1px solid rgb(255 255 255/.045)}.periods .h,.periods .c{padding-left:18px}.periods .h{color:var(--faint);border-top:0;padding-top:0;text-align:right}.periods .h:first-child{text-align:left}
.periods .n{color:var(--parchment);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.periods .c{text-align:right;font-variant-numeric:tabular-nums}.periods .c b{display:block;color:var(--parchment);font-weight:600;font-size:13px}.periods .c span{color:var(--faint)}
.chart{position:relative;height:220px;margin-top:12px;touch-action:pan-y}.chart svg{display:block;width:100%;height:100%;overflow:visible}
.chart .grid line{stroke:rgb(255 255 255/.06)}.chart text{fill:var(--faint);font:11px var(--sans)}
.tip{position:absolute;top:0;pointer-events:none;min-width:130px;padding:8px 10px;border-radius:8px;border:1px solid var(--edge-gold);background:rgb(18 19 25/.96);box-shadow:0 8px 24px rgb(0 0 0/.5);font-size:12px;opacity:0;transition:opacity .12s;z-index:2}
.tip.on{opacity:1}.tip b{display:block;color:var(--gold);font-weight:600;margin-bottom:3px}.tip div{display:flex;justify-content:space-between;gap:14px;color:var(--dim)}.tip div span:last-child{color:var(--parchment);font-variant-numeric:tabular-nums}.tip i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12px;color:var(--dim)}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:9px;height:9px;border-radius:2px}
.wait{display:grid;place-items:center;text-align:center;color:var(--faint);font-size:13px;height:100%;border:1px dashed var(--edge);border-radius:10px}
.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid2>*{min-width:0}
.split{display:flex;height:6px;border-radius:999px;overflow:hidden;background:var(--stone-3)}.split i{display:block;height:100%}
.split-l{display:flex;gap:10px;font-size:11px;color:var(--faint);margin-top:4px;white-space:nowrap;overflow:hidden}
.bars{display:flex;flex-direction:column;gap:8px;margin-top:12px}.bar-r{display:grid;grid-template-columns:minmax(52px,max-content) minmax(24px,1fr) auto;gap:10px;align-items:center;font-size:12px;color:var(--dim)}.bar-r .track{height:6px;border-radius:999px;background:var(--stone-3);overflow:hidden}.bar-r .track i{display:block;height:100%;background:var(--gold-soft);border-radius:999px}.bar-r b{color:var(--parchment);text-align:right;font-weight:500;font-variant-numeric:tabular-nums}
.switch{position:relative;width:40px;height:22px;border-radius:999px;border:1px solid var(--edge);background:var(--stone-3);cursor:pointer;flex:none;transition:background .15s}.switch::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dim);transition:transform .15s}
.switch[aria-checked=true]{background:rgb(201 162 39/.8);border-color:var(--gold-soft)}.switch[aria-checked=true]::after{transform:translateX(18px);background:var(--night)}.switch:disabled{opacity:.4;cursor:default}
.ad-t{margin-top:8px}.ad-r{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) auto;gap:4px 14px;align-items:center;padding:9px 0 9px 10px;border-top:1px solid rgb(255 255 255/.045);border-left:3px solid var(--edge);font-size:13px}.ad-r:first-child{border-top:0}.ad-r.ok{border-left-color:var(--ok)}.ad-r.gold{border-left-color:var(--gold)}
.ad-n{min-width:0}.ad-n b{font-weight:600;display:block}.ad-r .a{color:var(--faint);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}.ad-c{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ad-c .a{display:inline}.ad-c b{font-weight:600}.ad-c .l{display:none}.ad-s{justify-self:end}
.watch{margin-top:6px}.wl{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid var(--edge)}.wl .dot{margin-top:6px}.wl div{flex:1;min-width:0}.wl b{font-weight:600}.wl .sub{margin:2px 0 0}
.fine{border-top:1px solid var(--edge)}.fine summary{display:flex;align-items:center;gap:10px;padding:9px 0;color:var(--dim);cursor:pointer;list-style:none}.fine summary::-webkit-details-marker{display:none}.fine summary::after{content:"▾";margin-left:auto;color:var(--faint)}.fine[open] summary::after{content:"▴"}.fine .wl{padding-left:18px}
.rangebar{position:sticky;top:env(safe-area-inset-top);z-index:8;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 -8px 14px;padding:8px;border-radius:12px;background:rgb(11 12 16/.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}.rangebar .lab{margin-right:auto;color:var(--dim);font-size:12px;font-variant-numeric:tabular-nums}
.custom{display:flex;align-items:center;gap:6px;color:var(--faint);font-size:12px}.custom input{height:30px;padding:0 8px;border:1px solid var(--edge);border-radius:8px;background:var(--stone-2);color:var(--parchment);font:12px var(--sans);color-scheme:dark}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}.tile{padding:12px 14px;display:flex;flex-direction:column;min-width:0}.tile .k{color:var(--dim);font-size:12px;font-weight:500}.tile .v{font:600 22px/1.2 var(--sans);margin-top:4px;font-variant-numeric:tabular-nums}.tile .d{font-size:12px;color:var(--faint);margin-top:2px;line-height:1.35}.tile .d b{font-weight:600}.up{color:var(--ok)}.down{color:var(--blood)}.tile .split{height:8px;margin:9px 0 5px}
.ctl{display:flex;align-items:flex-start;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}.ctl-r{display:flex;gap:8px;flex-wrap:wrap}
.chiprow{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.chiprow .chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;flex:none}.chiprow .chip i{width:8px;height:8px;border-radius:2px}.chiprow .chip.off{opacity:.4}.chiprow .chip.on{border-color:var(--edge)}.chiprow .chip.all{color:var(--faint)}
table.lb{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;table-layout:auto}.lb th{color:var(--faint);font-weight:500;font-size:11px;text-align:right;padding:6px 8px;white-space:nowrap;user-select:none}.lb th[data-sort]{cursor:pointer}.lb th[data-sort]:hover{color:var(--dim)}.lb th:first-child{text-align:left;padding-left:0}.lb th.on{color:var(--gold)}
.lb td{padding:8px;border-top:1px solid rgb(255 255 255/.045);vertical-align:middle}.lb td:first-child{padding-left:0}.lb .n{font-weight:600;white-space:nowrap;max-width:0;width:34%;overflow:hidden;text-overflow:ellipsis}.lb .n i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:8px}.lb .ver{margin-left:8px;color:var(--faint);font-weight:400;font-size:11px}
.lb .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.lb .num b{font-weight:600}.lb .dl{display:block;font-size:11px;color:var(--faint)}.lb .tot{color:var(--dim)}.lb td.sp{width:76px;padding-top:4px;padding-bottom:4px}.lb td.sp svg{display:block}.lb td.st{width:150px}.lb .st .split-l{font-size:10px;gap:6px}.lb tr.cut{display:none}
.rel-t{margin-top:4px}.rel-t td{padding:7px 8px}.rel-t .n{width:auto;max-width:none}
.moves{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px;font-size:12px;color:var(--dim)}.moves b{color:var(--parchment);font-weight:500}
.rel{padding:10px 0;border-top:1px solid rgb(255 255 255/.045)}.rel:first-of-type{border-top:0}.rel-h{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}.rel-h b{font-weight:600}.rel-h .sub{margin:0}
.notif{display:flex;align-items:center;gap:14px;padding:16px 18px}
.tools{display:flex;align-items:center;gap:6px}.refresh{width:36px;padding:0;height:36px}.refresh.busy .ic,.pull.busy .ic{animation:spin .8s linear infinite}
.pull{position:fixed;top:env(safe-area-inset-top);left:50%;z-index:20;width:40px;height:40px;margin-left:-20px;border-radius:50%;display:grid;place-items:center;background:var(--stone-2);border:1px solid var(--edge);color:var(--dim);opacity:0;transform:translateY(-60px);transition:transform .2s,opacity .2s,color .15s,border-color .15s;box-shadow:0 6px 18px rgb(0 0 0/.45);pointer-events:none}
.pull.held{opacity:1}
.pull.held{transition:opacity .15s}.pull.ready{color:var(--gold);border-color:var(--edge-gold)}.pull .ic{width:18px;height:18px}
@keyframes spin{to{transform:rotate(360deg)}}.notif .grow{flex:1;min-width:0}.notif p{margin:2px 0 0;color:var(--dim);font-size:13px}

@media (max-width:1000px){.kpis,.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.grid2{grid-template-columns:minmax(0,1fr)}}
@media (max-width:760px){
  .side{display:none}main{margin:0;padding:14px 12px calc(84px + env(safe-area-inset-bottom));padding-top:calc(14px + env(safe-area-inset-top))}
  .top h1{font-size:21px}.top .brandm{display:flex;align-items:center;gap:10px}.top .brandm img{width:32px;height:32px;border-radius:8px}
  .hero{padding:14px}.hero .raven,.hero .raven img{width:46px;height:46px}.hero h2{font-size:17px}
  .kpis{gap:10px}.kpi{padding:12px 12px 8px}.kpi .v{font-size:22px}
  .chart{height:190px}.card{padding:14px}
  .tiles{gap:10px}.tile{padding:10px 12px}.tile .v{font-size:19px}
  .rangebar{margin:0 -4px 12px;padding:6px 4px}.rangebar .lab{display:none}.rangebar .seg{flex:1;justify-content:space-between}.rangebar .seg button{padding:5px 7px}.custom{width:100%}.custom input{flex:1;min-width:0}
  .chiprow{flex-wrap:nowrap;overflow-x:auto;margin-right:-14px;padding-right:14px;scrollbar-width:none}.chiprow::-webkit-scrollbar{display:none}
  .lb .pp,.lb .tot,.lb .st,.lb .ver{display:none}.lb .n{width:auto}
  .ad-r{position:relative;grid-template-columns:minmax(0,1fr) minmax(0,1fr);padding-left:8px;gap:2px 10px}.ad-n{grid-column:1/-1}.ad-r.ok .ad-n,.ad-r.gold .ad-n{padding-right:120px}.ad-c .l{display:block;color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.04em}.ad-s{position:absolute;right:0;top:9px}
  .tabs{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:10;justify-content:space-around;padding:6px 6px calc(6px + env(safe-area-inset-bottom));background:rgb(18 19 25/.92);backdrop-filter:blur(10px);border-top:1px solid var(--edge)}
  .tabs a{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;color:var(--faint);padding:4px 2px;border-radius:8px;min-width:52px;flex:1}.tabs a .ic{width:20px;height:20px}.tabs a.on{color:var(--gold)}
}
@media (min-width:761px){.top .brandm img{display:none}}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}html{scroll-behavior:auto}}
`;

const ICON: Record<string, string> = {
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  release: '<path d="M12 22V12"/><path d="m16 17 2 2 4-4"/><path d="M21 11.127V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l1.32-.753"/><path d="M3.29 7 12 12l8.71-5"/><path d="m7.5 4.27 8.997 5.148"/>',
  comment: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
};
const icon = (name: string, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/** The page's head: the app's manifest, icons and colours. */
function head(title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0b0c10">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Ravenpost">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${STYLE}</style></head>`;
}

// (the service worker, for the notifications and the app on a phone)
const SW = `<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js")</script>`;

/** Signing in, with Battle.net (back here after, in the app on a phone too). */
export function signinPage(): string {
  return `${head("Ravenpost")}<body><div style="min-height:100vh;display:grid;place-items:center;padding:24px">
<div class="panel" style="width:min(400px,100%);padding:30px 28px;text-align:center">
<img src="/icon-192.png" alt="" style="width:84px;height:84px;border-radius:18px;box-shadow:0 0 30px rgb(242 193 78/.25)">
<h1 class="title" style="font-size:26px;margin-top:16px">Ravenpost</h1>
<p style="color:var(--dim);margin:6px 0 24px">The addons' numbers and their data jobs, for their owner.</p>
<a class="btn btn-bnet" href="/api/login?web=1">Sign in with Battle.net</a>
</div></div>${SW}</body></html>`;
}

// ── the parts ────────────────────────────────────────────────────────────────
const KIND: Record<Event["kind"], { icon: string; label: string; group: string }> = {
  merged: { icon: "merge", label: "Merged", group: "data" },
  release: { icon: "release", label: "Release", group: "data" },
  failed: { icon: "x", label: "Failed", group: "problems" },
  waiting: { icon: "clock", label: "Waiting", group: "problems" },
  digest: { icon: "sun", label: "Digest", group: "digests" },
  comment: { icon: "comment", label: "Comment", group: "comments" },
  test: { icon: "send", label: "Test", group: "data" },
};
function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const SETTLED: Record<Resolution["how"], string> = { merged: "Merged", closed: "Closed", passed: "Passed since" };

function feed(list: Event[], resolved: Record<string, Resolution> = {}): string {
  if (!list.length) return `<p class="empty">Nothing yet. The data jobs report here each morning, then the digest.</p>`;
  const rows = list
    .slice(0, 60)
    .map((e) => {
      const k = KIND[e.kind];
      const done = (e.kind === "failed" || e.kind === "waiting") && e.url ? resolved[e.url] : undefined;
      return `<li data-group="${k.group}" data-at="${esc(e.at)}"${done ? ' class="done"' : ""}><span class="i ${e.kind}">${icon(k.icon)}</span><div class="c">
<div class="t"><b>${esc(e.title)}</b><time datetime="${esc(e.at)}" title="${esc(e.at.slice(0, 16).replace("T", " "))} UTC">${ago(e.at)}</time></div>
${e.body ? `<div class="b">${esc(e.body)}</div>` : ""}
<div class="m">${done ? `<span class="tag ok" title="${esc(done.at.slice(0, 16).replace("T", " "))} UTC">${SETTLED[done.how]} ${ago(done.at)}</span>` : ""}${e.repo ? `<span class="tag">${esc(cap(REPO_NAMES[e.repo] ?? e.repo))}</span>` : ""}${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${e.url.includes("/pull/") ? "Pull request" : e.url.includes("/actions/") ? "The run" : e.url.includes("curseforge.com") ? "Answer on CurseForge" : "Open"} ↗</a>` : ""}</div>
</div></li>`;
    })
    .join("");
  // (five rows shown, the rest a scroll away: the page measures the fifth)
  return `<div class="scroll" id="feed-scroll"><ul class="feed">${rows}</ul></div>`;
}

/** Under the rank chart: where each addon stands now and how far it moved in 7 days, the favorites and thumbs up in all. */
function rankMoves(h: History): string {
  const days = Object.keys(h.days).filter((d) => h.days[d]?.curseforge).sort();
  if (!days.length) return `<p class="sub" style="margin-top:10px">The daily numbers fill this in, once CurseForge's key is set.</p>`;
  const last = days[days.length - 1];
  const cut = new Date(Date.parse(last) - 7 * DAY).toISOString().slice(0, 10);
  const base = [...days].reverse().find((d) => d <= cut) ?? (days.length > 1 ? days[0] : undefined);
  const now = h.days[last].curseforge!;
  const was = base ? h.days[base].curseforge! : {};
  const list = Object.entries(now).filter(([, s]) => s.rank).sort((a, b) => a[1].rank! - b[1].rank!);
  const moves = list
    .map(([name, s]) => {
      const moved = was[name]?.rank ? was[name].rank! - s.rank! : null;
      const m = moved ? ` <span style="color:${moved > 0 ? "var(--ok)" : "var(--blood)"}">${moved > 0 ? "▲" : "▼"} ${fmt(Math.abs(moved))}</span>` : "";
      return `<span class="mv"><b>${esc(name)}</b> #${fmt(s.rank)}${m}</span>`;
    })
    .join("");
  const fav = list.reduce((t, [, s]) => t + (s.favorites ?? 0), 0);
  const likes = list.reduce((t, [, s]) => t + (s.likes ?? 0), 0);
  return `<div class="moves">${moves}</div><p class="sub" style="margin-top:8px">${base ? `Moves since ${short(base)}` : "Moves show from tomorrow"} · ♥ ${fmt(fav)} favorites · 👍 ${fmt(likes)} in all</p>`;
}

/** Each addon's newest CurseForge release: how long it's been live, its downloads, and a day (the fastest first). */
function releasesVelocity(releases: Record<string, Release[]>, now = Date.now()): string {
  const list = Object.entries(releases)
    .filter(([, r]) => r.length)
    .map(([name, rs]) => {
      const r = rs[0];
      const live = Math.max(0, (now - Date.parse(r.at)) / DAY);
      return { name, r, live, rate: r.downloads / Math.max(1, live) };
    })
    .sort((a, b) => b.rate - a.rate);
  if (!list.length) return `<p class="empty" style="padding:12px 0 0">The first look at CurseForge fills this in.</p>`;
  const lived = (d: number) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h live` : `${Math.round(d)} d live`);
  return `<table class="lb rel-t"><tbody>${list
    .map(
      ({ name, r, live, rate }) =>
        `<tr><td class="n"><span class="nm">${esc(name)}</span><span class="ver">${esc(r.version)}</span></td><td class="num">${fmt(r.downloads)}<span class="dl">${lived(live)}</span></td><td class="num"><b>${fmt(Math.round(rate))}</b><span class="dl">a day</span></td></tr>`,
    )
    .join("")}</tbody></table>`;
}

/** Each addon's standing across the stores and the data jobs, and what the launch watch sees right now: read only. */
export function addonsSection(h: History, td: Today | null, gh: Record<string, GitHubRelease>, cf: Record<string, Release[]>, events: Event[], now = Date.now()): string {
  const watch = checks(h, td, gh, cf, new Date(now));
  const dot = (l: string) => (l === "warn" ? "blood" : l === "good" || l === "note" ? "gold" : "ok");
  const line = (c: (typeof watch)[number]) => `<div class="wl"><span class="dot ${dot(c.level)}"></span><div><b>${esc(c.title)}</b><p class="sub">${esc(c.line)}</p></div></div>`;
  // (what needs a look in full, the checks that are fine folded into one line)
  const loud = watch.filter((c) => c.level !== "ok");
  const fine = watch.filter((c) => c.level === "ok");
  const watchRows = `${loud.map(line).join("")}${fine.length ? `<details class="fine"><summary><span class="dot ok"></span>${fine.length === 1 ? "1 check fine" : `${fine.length} checks fine`}</summary>${fine.map(line).join("")}</details>` : ""}`;
  const rows = ADDONS.map(([name, , , , repo]) => {
    const g = gh[name], c = cf[name]?.[0];
    const job = events.find((e) => e.repo === repo && (e.kind === "merged" || e.kind === "failed" || e.kind === "waiting"));
    const b = behind(g, cf[name], now);
    const status = b ? `<span class="tag gold">${b.hours >= DRIFT_HOURS ? "Not on CurseForge" : "CurseForge"} · ${b.hours} h</span>` : g && c ? `<span class="tag ok">In step</span>` : "";
    const tone = b ? "gold" : g && c ? "ok" : "";
    const cfv = c ? `<b>${esc(c.version)}</b> <span class="a">${ago(c.at, now)}</span>` : cf[name] || !ADDONS.find((a) => a[4] === repo)?.[1] ? "–" : `<span class="a">not read yet</span>`;
    const ghv = g ? `<a href="${esc(g.url)}" rel="noopener"><b>${esc(g.tag)}</b></a> <span class="a">${ago(g.at, now)}</span>` : "–";
    return `<div class="ad-r ${tone}"><div class="ad-n"><b>${esc(name)}</b>${job ? `<span class="a">${esc(job.title)}, ${ago(job.at, now)}</span>` : ""}</div><div class="ad-c"><span class="l">GitHub</span>${ghv}</div><div class="ad-c"><span class="l">CurseForge</span>${cfv}</div><div class="ad-s">${status}</div></div>`;
  }).join("");
  return `<div class="panel card"><h3>Launch watch</h3><p class="sub">Checked every ten minutes. A warning is told to your devices once a day.</p><div class="watch">${watchRows}</div></div>
<div class="panel card" style="margin-top:12px"><h3>The addons</h3><p class="sub">Each one's newest release on GitHub and CurseForge, and its last data job</p><div class="ad-t">${rows}</div></div>`;
}

/** Different Ravenpost installs over 7 and 30 days and since counting began, to a day: each counted once, however many days it ran. */
function installsCard(d: Distinct | undefined, through: string | undefined): string {
  if (!d || !through) return `<p class="empty" style="padding:12px 0 0">Different installs: counted from the first pings the inbox keeps.</p>`;
  const cell = (n: number, line: string) => `<span class="c"><b>${fmt(n)}</b><span>${line}</span></span>`;
  return `<div class="periods"><span class="h">Different installs</span><span class="h">7 days</span><span class="h">30 days</span><span class="h">Since ${short(d.since)}</span>
<span class="n">Ravenpost</span>${cell(d.week, d.newWeek === null ? "–" : `${fmt(d.newWeek)} new`)}${cell(d.month, d.newMonth === null ? "–" : `${fmt(d.newMonth)} new`)}${cell(d.ever, "in all")}</div>
<p class="sub" style="margin-top:10px">Each install once, however many days it ran, to ${short(through)}. A player on two computers counts twice.</p>`;
}

/** The addons' latest comment threads: who wrote, the replies (the owner's set apart), whether one waits for an answer. */
function threadsList(threads: Thread[]): string {
  if (!threads.length) return `<p class="empty">No comments yet. They show here, and on your phone, within ten minutes.</p>`;
  return threads
    .slice(0, 40)
    .map(
      (t) => `<div class="thread" data-open="${t.answered ? 0 : 1}"><div class="t"><b>${esc(t.author)}</b><span class="tag">${esc(t.addon)}</span>${t.answered ? `<span class="tag ok">Answered</span>` : `<span class="tag gold">To answer</span>`}<time title="${esc(t.at.slice(0, 16).replace("T", " "))} UTC">${ago(t.at)}</time></div>
<div class="x">${esc(t.text)}</div>
${t.replies.map((r) => `<div class="r${r.owner ? " me" : ""}"><b>${esc(r.author)}</b> <span>· ${ago(r.at)}</span><div>${esc(r.text)}</div></div>`).join("")}
<div class="a"><a href="${esc(t.url)}" target="_blank" rel="noopener">${t.answered ? "Open on CurseForge" : "Answer on CurseForge"} ↗</a></div></div>`,
    )
    .join("");
}

/**
 * How things stand: a failure first, then a pull request waiting, else quiet.
 * A problem GitHub has seen settled (merged, closed, passed since: github.ts)
 * is none; one GitHub can say nothing of lasts 36 hours, one it can a week
 * while still open. A job failing again, or a pull request told each day,
 * counts once.
 */
export function standing(events: Event[], resolved: Record<string, Resolution> = {}, now = Date.now()) {
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
  const failed = open("failed");
  const waiting = open("waiting");
  if (failed.length) return { tone: "blood", icon: "x", title: failed.length > 1 ? `${failed.length} jobs failed` : "A job failed", line: failed.map((e) => e.title).join(" · ") };
  if (waiting.length) return { tone: "gold", icon: "clock", title: waiting.length > 1 ? `${waiting.length} things wait for you` : "Something waits for you", line: waiting.map((e) => e.title).join(" · ") };
  const last = events.find((e) => e.kind !== "digest");
  return { tone: "ok", icon: "check", title: "All quiet", line: last ? `Last word ${ago(last.at, now)}: ${last.title}` : "The data jobs report here each morning." };
}

const lastOf = (xs: N[]) => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return xs[i];
  return null;
};

export function dashboard(
  h: History,
  opts: {
    viewer?: string;
    events?: Event[];
    pushKey?: string | null;
    devices?: number;
    readings?: Reading[];
    releases?: Record<string, Release[]>;
    threads?: Thread[];
    resolved?: Record<string, Resolution>;
    today?: Today | null;
    unique?: UniquePeriods | null;
    github?: Record<string, GitHubRelease>;
    now?: number;
  } = {},
): string {
  const td = opts.today ?? null;
  // (the day's visitors so far, from the ten-minute look, on the day the daily job has not summed yet)
  const live = td?.traffic ? { ...h, days: { ...h.days, [td.day]: { ...h.days[td.day], traffic: td.traffic } } } : h;
  const s = seriesOf(withDownloadReadings(live, opts.readings ?? []));
  const events = opts.events ?? [];
  const resolved = opts.resolved ?? {};
  const st = standing(events, resolved, opts.now);
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
  const shares = (m: Record<string, number> | undefined, empty: string) => {
    const e = Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]);
    const hi = Math.max(1, ...e.map(([, v]) => v));
    return e.length
      ? `<div class="bars">${e.map(([k, v]) => `<div class="bar-r"><span>${esc(k)}</span><span class="track"><i style="width:${Math.max(4, (100 * v) / hi)}%"></i></span><b>${fmt(v)}</b></div>`).join("")}</div>`
      : `<p class="empty" style="padding:12px 0 0">${empty}</p>`;
  };
  const CH = { curseforge: ["CurseForge", "#f16436"], wago: ["Wago", "#f2c14e"], github: ["GitHub", "#a39b88"] } as const;
  const listed = [...s.downloads.addons, ...ADDONS.map((a) => a[0]).filter((n) => !s.downloads.addons.includes(n))];
  const releases = opts.releases ?? {};
  const version = (a: string) => releases[a]?.[0]?.version ?? opts.github?.[a]?.tag.replace(/^v/, "");
  // (the leaderboard: what doesn't move with the range here, the range's columns filled in by the page)
  const rows = listed
    .map((a, k) => {
      const c = s.downloads.channels[a] ?? {};
      const t = s.downloads.totals[a] ?? 0;
      const counted = a in s.downloads.totals;
      const parts = (Object.keys(CH) as (keyof typeof CH)[]).filter((x) => c[x]);
      const v = version(a);
      return `<tr data-a="${esc(a)}" data-all="${counted ? t : -1}"><td class="n"><i style="background:${counted ? `var(--c${k % 10})` : "var(--edge)"}"></i><span class="nm">${esc(a)}</span>${v ? `<span class="ver">${esc(v)}</span>` : ""}</td>
<td class="num rg">–</td><td class="num pp">–</td><td class="sp"></td><td class="num tot">${counted ? fmt(t) : "–"}</td>
<td class="st"><span class="split">${parts.map((x) => `<i style="width:${(100 * (c[x] ?? 0)) / (t || 1)}%;background:${CH[x][1]}"></i>`).join("")}</span><span class="split-l">${parts.map((x) => `<span>${CH[x][0]} ${fmt(c[x])}</span>`).join("")}</span></td></tr>`;
    })
    .join("");
  // (the releases on the chart: CurseForge's for the addons, GitHub's newest for Ravenpost)
  const marks = [
    ...Object.entries(releases).flatMap(([a, rs]) => rs.map((r) => ({ day: r.at.slice(0, 10), text: `${a} ${r.version}` }))),
    ...Object.entries(opts.github ?? {})
      .filter(([a]) => !ADDONS.find((x) => x[0] === a)?.[1])
      .map(([a, g]) => ({ day: g.at.slice(0, 10), text: `${a} ${g.tag.replace(/^v/, "")}` })),
  ].filter((m) => s.days.includes(m.day));
  const kpi = (id: string, ic: string, label: string, value: string, line: string) =>
    `<div class="panel kpi"><span class="k">${icon(ic)}${esc(label)}</span><span class="v">${value}</span><span class="d">${line}</span><div class="spark" id="${id}"></div></div>`;
  const NAV = [
    ["overview", "house", "Overview"],
    ["activity", "activity", "Activity"],
    ["downloads", "download", "Downloads"],
    ["addons", "clock", "Addons"],
    ["players", "users", "Players"],
    ["sites", "globe", "Sites"],
    ["comments", "comment", "Comments"],
    ["notifications", "bell", "Notifications"],
  ];
  const PHONE = ["overview", "activity", "downloads", "addons", "players", "comments"];
  const hourly = hourlyOf(opts.readings ?? []);
  const downloadsChecked = [...(opts.readings ?? [])].map(([at]) => at).sort().at(-1);
  const threads = opts.threads ?? [];
  const toAnswer = threads.filter((t) => !t.answered).length;
  const data = {
    ...s,
    hourly,
    visitors,
    labels: s.days.map(short),
    since: s.downloads.since.map((d) => (d ? short(d) : null)),
    periods: opts.unique?.periods ?? {},
    marks,
    stores: Object.entries(CH).map(([k, [name, color]]) => ({ key: k, name, color })),
  };
  const firstCounted = s.downloads.early.indexOf(false);
  const RANGES: [string, string][] = [["24h", "24 h"], ["7", "7 d"], ["30", "30 d"], ["90", "90 d"], ["0", "All"], ["c", "Custom"]];
  const tile = (id: string, label: string) => `<div class="panel tile" id="${id}"><span class="k">${label}</span><span class="v">–</span><span class="d">&nbsp;</span></div>`;
  const dailyNote = `<p class="sub daily-note" hidden>Daily numbers: the last 7 days shown.</p>`;
  return `${head("Ravenpost")}<body>
<aside class="side"><div class="brand"><img src="/icon-192.png" alt=""><div><p class="title">Ravenpost</p><small>The inbox</small></div></div>
<nav class="nav">${NAV.map(([id, ic, label]) => `<a href="#${id}" data-nav="${id}">${icon(ic)}<span style="flex:1">${label}</span>${id === "comments" ? `<span id="nav-answer">${toAnswer ? `<span class="tag gold" style="height:18px">${toAnswer}</span>` : ""}</span>` : ""}</a>`).join("")}</nav>
<div class="side-foot"><p id="side-standing" style="display:flex;align-items:center;gap:8px;color:var(--dim)"><span class="dot ${st.tone} pulse"></span>${esc(st.title)}</p><p id="daily-snapshot">${h.updated ? `Daily snapshot of ${esc(h.updated.slice(0, 10))}, ${esc(h.updated.slice(11, 16))} UTC` : "No daily snapshot yet"}</p>${opts.viewer ? `<p>${esc(opts.viewer)}</p>` : ""}</div></aside>
<nav class="tabs">${NAV.filter(([id]) => PHONE.includes(id)).map(([id, ic, label]) => `<a href="#${id}" data-nav="${id}">${icon(ic)}${label}</a>`).join("")}</nav>
<main>
<div class="top" id="overview"><div class="brandm"><img src="/icon-192.png" alt=""><div><h1 class="title">Overview</h1><p><span id="to-day">${lastDay ? `To ${short(lastDay)}` : "No numbers yet"}</span><span id="fresh"></span></p></div></div>
<div class="tools"><button class="btn btn-ghost refresh" id="refresh" aria-label="Refresh" title="Refresh">${icon("refresh")}</button></div></div>
<div class="pull" id="pull" aria-hidden="true">${icon("refresh")}</div>
<div class="rangebar" id="rangebar"><span class="lab" id="range-label"></span><div class="seg" role="group" aria-label="Range">${RANGES.map(([k, l]) => `<button data-range="${k}">${l}</button>`).join("")}</div>
<div class="custom" id="custom" hidden><input type="date" id="from" aria-label="From" min="${s.days[0] ?? ""}" max="${lastDay ?? ""}"><span>to</span><input type="date" id="to" aria-label="To" min="${s.days[0] ?? ""}" max="${lastDay ?? ""}"></div></div>

<div class="panel hero" id="hero"><div class="raven"><img src="/icon-192.png" alt=""><span class="badge ${st.tone}">${icon(st.icon)}</span></div><div class="grow"><h2 class="title">${esc(st.title)}</h2><p>${esc(st.line)}</p></div></div>

<div class="kpis">
${kpi("k-dl", "download", "Downloads", fmt(total), [hourly.today !== null ? `<b>+${fmt(hourly.today)}</b> today` : "", `<span id="k-dl-r">${week !== null ? `${signed(week)} in 7 days` : ""}</span>`].filter(Boolean).join(" · ") || "every addon, every store")}
${kpi("k-in", "users", "Ravenpost in use", fmt(rp?.installs), ["yesterday", td ? `<b>${fmt(td.installs)}</b> today so far` : ""].filter(Boolean).join(" · "))}
${kpi("k-fa", "send", "Facts shared", fmt(sh?.facts), ["yesterday", td ? `<b>${fmt(td.facts)}</b> today so far` : ""].filter(Boolean).join(" · "))}
${kpi("k-vi", "globe", "Site visitors", fmt(lastOf(visitors)), [Object.keys(s.sites).length ? Object.keys(s.sites).join(" · ") : "Web Analytics", visitorsToday !== null ? `<b>${fmt(visitorsToday)}</b> today so far` : ""].filter(Boolean).join(" · "))}
</div>

<section id="activity"><div class="sh"><h2 class="title">Activity</h2><div class="chips" role="group" aria-label="Show">${[
    ["all", "All"],
    ["data", "Data"],
    ["problems", "Problems"],
    ["comments", "Comments"],
    ["digests", "Digests"],
  ]
    .map(([k, l], i) => `<button class="chip${i ? "" : " on"}" data-filter="${k}">${l}</button>`)
    .join("")}</div></div>
<div class="panel" id="feed">${feed(events, resolved)}</div></section>

<section id="downloads"><div class="sh"><h2 class="title">Downloads</h2><p id="dl-span"></p></div>
<div class="tiles">${tile("t-dl", "Downloads")}${tile("t-pp", "Different people")}${tile("t-best", "Best day")}${tile("t-st", "Stores")}</div>
<div class="panel card"><div class="ctl"><div><h3 data-mode="all">New downloads</h3><h3 data-mode="unique">Different people a day</h3></div>
<div class="ctl-r"><div class="seg" role="group" aria-label="Count"><button data-dl="all" class="on">All</button><button data-dl="unique">Unique</button></div><div class="seg" role="group" aria-label="View" data-mode="all"><button data-view="addon" class="on">By addon</button><button data-view="store">By store</button><button data-view="lines">Lines</button></div></div></div>
<p class="sub" data-mode="all" id="dl-note">Download events on every store: one player downloading twice counts twice.${firstCounted > 0 ? ` Before ${short(s.days[firstCounted])}, CurseForge's own daily count alone (paler): Wago and GitHub keep only totals.` : ""}${marks.length ? " Gold marks: releases." : ""}</p>
<p class="sub" data-mode="unique" id="unique-through">${s.days.some((d) => h.days[d]?.unique) ? `CurseForge's own count, to ${short(s.days.filter((d) => h.days[d]?.unique).at(-1)!)}: Wago and GitHub don't count people${opts.unique?.at ? `, brought ${ago(opts.unique.at)}` : ""}.` : "CurseForge's own count, not brought yet (CURSEFORGE_COOKIE on Vercel, read hourly)."}</p>
<div class="chart" id="c-dl"></div><div class="chiprow" id="chips-dl" role="group" aria-label="Addons"></div>
<table class="lb" id="download-rows"><thead><tr><th data-sort="name">Addon</th><th data-sort="range" id="lb-range">In range</th><th data-sort="people" class="pp">People</th><th class="sp">Trend</th><th data-sort="all" class="tot">All time</th><th class="st">Stores</th></tr></thead><tbody>${rows}</tbody></table>
<button class="more" id="lb-more" hidden></button>
<p class="sub" id="downloads-checked" style="margin-top:10px">Download events, not players: People is CurseForge's count over 7, 30 or 90 days, each addon's own. CurseForge and Wago are read every ten minutes, GitHub every hour${downloadsChecked ? `, last ${esc(downloadsChecked.slice(0, 10))} at ${esc(downloadsChecked.slice(11, 16))} UTC` : ""}.</p></div>
<div class="grid2" style="margin-top:12px;align-items:start">
<div class="panel card" id="download-popularity"><h3>Rank on CurseForge</h3><p class="sub">Among every WoW addon, by popularity: higher is better</p>${dailyNote}<div class="chart" id="c-rk" style="height:180px"></div>${rankMoves(h)}</div>
<div class="panel card" id="download-releases"><h3>Newest releases</h3><p class="sub">Each addon's newest on CurseForge: its downloads since it went live, and a day</p>${releasesVelocity(releases, opts.now)}</div>
</div></section>

<section id="addons"><div class="sh"><h2 class="title">Addons</h2><p>The launch watch and the stores</p></div>
<div id="addons-body">${addonsSection(h, td, opts.github ?? {}, releases, events, opts.now)}</div></section>

<section id="players"><div class="sh"><h2 class="title">Players</h2><p>Ravenpost and the shared facts</p></div>
<div class="grid2">
<div class="panel card"><h3>Ravenpost in use</h3><p class="sub">The installs running that day, one anonymous ping each (0.4.0 and later: earlier releases never ping), and the different ones over 7 days</p>${dailyNote}<div class="chart" id="c-in" style="height:170px"></div><div class="legend" id="l-in"></div>
${installsCard(distinct, distinctTo)}
<div class="grid2" style="gap:14px;margin-top:14px"><div><p class="sub">Versions</p>${shares(rp?.versions, "–")}</div><div><p class="sub">Systems</p>${shares(rp?.os, "–")}</div></div>
<p class="sub" style="margin-top:12px">Linked</p>${shares(rp?.linked, "None yet.")}</div>
<div class="panel card"><h3>Facts shared</h3><p class="sub">A day, and the ones new to the database</p>${dailyNote}<div class="chart" id="c-fa" style="height:170px"></div><div class="legend" id="l-fa"></div>
<div class="grid2" style="gap:14px;margin-top:6px"><div><p class="sub">Games</p>${shares(sh?.games, "–")}</div><div><p class="sub">Languages</p>${shares(sh?.locales, "–")}</div></div></div>
</div></section>

<section id="sites"><div class="sh"><h2 class="title">Sites</h2>${Object.keys(s.sites).length ? `<div class="seg" role="group" aria-label="Count"><button data-site="visitors" class="on">Visitors</button><button data-site="pageviews">Page views</button></div>` : "<p>Visitors a day</p>"}</div>
<div class="panel card">${Object.keys(s.sites).length ? `${dailyNote}<div class="chart" id="c-vi"></div><div class="legend" id="l-vi"></div>` : `<p class="empty" style="padding:4px 0">No traffic numbers yet. Web Analytics feeds them once its token is set.</p>`}</div></section>

<section id="comments"><div class="sh"><h2 class="title">Comments</h2><div class="chips" role="group" aria-label="Show">${[
    ["open", `To answer${toAnswer ? ` (${toAnswer})` : ""}`],
    ["all", "All"],
  ]
    .map(([k, l], i) => `<button class="chip${(toAnswer ? i === 0 : i === 1) ? " on" : ""}" data-threads="${k}">${l}</button>`)
    .join("")}</div></div>
<div class="panel" id="threads"><div class="scroll" id="threads-scroll">${threadsList(threads)}</div><p class="empty" id="no-open" hidden>Nothing to answer: every comment has your reply.</p></div></section>

<section id="notifications"><div class="sh"><h2 class="title">Notifications</h2><p id="notif-count">${opts.devices ? `${fmt(opts.devices)} device${opts.devices === 1 ? "" : "s"} told` : "No device told yet"}</p></div>
<div class="panel notif"><div class="grow"><b>This device</b><p id="push-state">…</p></div><button class="btn btn-ghost" id="push-test" hidden>Send a test</button><button class="switch" id="push-switch" role="switch" aria-checked="false" aria-label="Notifications on this device" disabled></button></div>
<p class="sub" style="margin:10px 4px 0">The data jobs as they finish, and a digest each morning. On a phone: add this page to the Home Screen, open Ravenpost from there, sign in, then turn them on.</p></section>
</main>
<script type="application/json" id="data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
${SW}${SCRIPT(opts.pushKey ?? null)}</body></html>`;
}

// ── the page's script: the charts, the activity's filters, the nav, the notifications ──
const SCRIPT = (key: string | null) => `<script>
(()=>{
let D=JSON.parse(document.getElementById("data").textContent);
const C=["#f2c14e","#6cb4ee","#6fd08c","#e0634f","#b58cf0","#ece3cf","#5fd3c4","#f08a4b","#ef7fb6","#b9d65a"];
C.forEach((c,i)=>document.documentElement.style.setProperty("--c"+i,c));
const $=(id)=>document.getElementById(id);
const nf=(v)=>v==null?"–":Math.round(v).toLocaleString("en-GB");
const NS="http://www.w3.org/2000/svg";
const el=(tag,a={},p)=>{const e=document.createElementNS(NS,tag);for(const k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e};
const nice=(v)=>{if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));const n=v/p;return ([1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(s=>n<=s))*p};
// Stable across releases, with browser storage optional (private browsing).
const PREFS="ravenpost.dashboard.preferences";
let prefs={};try{const saved=JSON.parse(localStorage.getItem(PREFS)||"{}");if(saved&&typeof saved==="object"&&!Array.isArray(saved))prefs=saved}catch{}
const remember=(key,value)=>{prefs[key]=value;try{localStorage.setItem(PREFS,JSON.stringify(prefs))}catch{}};
const hidden=(key)=>Array.isArray(prefs[key])?prefs[key].filter(x=>typeof x==="string"):[];
// The range, the whole page's: 24 hours (the downloads hour by hour, the daily charts their last 7 days), 7, 30, 90 days, all, or two dates.
const RANGES=["24h","7","30","90","0","c"];
let range=String(prefs.range??"30");if(!RANGES.includes(range))range="30";
let from=typeof prefs.from==="string"?prefs.from:null,to=typeof prefs.to==="string"?prefs.to:null;
const hourly=()=>range==="24h";
/** The days shown: [first, end) in D.days. */
function span(){const n=D.days.length;
  if(range==="24h")return [Math.max(0,n-7),n];
  if(range==="c"&&from&&to){let a=D.days.findIndex(d=>d>=from);if(a<0)a=n;let b=n;while(b>0&&D.days[b-1]>to)b--;return [a,Math.max(a,b)]}
  const r=+range;return r?[Math.max(0,n-r),n]:[0,n]}
const cut=(xs)=>{const [a,b]=span();return xs.slice(a,b)};
/** The span as long just before, or null where the numbers don't reach it. */
function prior(){if(range==="0")return null;const [a,b]=span();const n=b-a;return n&&a-n>=0?[a-n,a]:null}
const total=(xs)=>{let t=null;for(const v of xs)if(v!=null)t=(t||0)+v;return t};
const rangeName=()=>({"24h":"24 h","7":"7 d","30":"30 d","90":"90 d","0":"all","c":"the range"})[range];
// (a smooth line through the points: monotone, it never overshoots)
function smooth(p){if(p.length<2)return "";const n=p.length,d=[],m=[];for(let i=0;i<n-1;i++)d.push((p[i+1][1]-p[i][1])/(p[i+1][0]-p[i][0]||1));m.push(d[0]);for(let i=1;i<n-1;i++)m.push(d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2);m.push(d[n-2]);
for(let i=0;i<n-1;i++){if(d[i]===0){m[i]=m[i+1]=0;continue}const a=m[i]/d[i],b=m[i+1]/d[i],s=a*a+b*b;if(s>9){const t=3/Math.sqrt(s);m[i]=t*a*d[i];m[i+1]=t*b*d[i]}}
let s="M"+p[0][0]+","+p[0][1];for(let i=0;i<n-1;i++){const h=(p[i+1][0]-p[i][0])/3;s+="C"+(p[i][0]+h)+","+(p[i][1]+m[i]*h)+" "+(p[i+1][0]-h)+","+(p[i+1][1]-m[i]*h)+" "+p[i+1][0]+","+p[i+1][1]}return s}
/** A chart at its box's size, a value under the finger: "bars" (stacked: pale ones for the days CurseForge counted alone, lines laid over), "area" (lines with a soft fill), "lines"; inverted for a rank; the releases marked. */
function chart(box,{type,series,labels,since,format=nf,whole,pale,marks,invert,trim,over=[]}){
  if(!box)return;box.innerHTML="";
  // (trim: the days before the first number left out, for a part counted later than the downloads)
  const [a0,b0]=whole?[0,labels.length]:span();
  let off=a0;if(trim)while(off<b0&&![...series,...over].some(s=>s.values[off]!=null))off++;
  const take=(xs)=>whole?xs:xs.slice(off,b0);
  const lab=take(labels),ser=series.map(s=>({...s,v:take(s.values)})),ov=over.map(s=>({...s,v:take(s.values)})),pl=pale?take(pale):[];
  const n=lab.length,has=ser.some(s=>s.v.filter(v=>v!=null).length>(type==="bars"?0:1));
  if(!n||!has){const w=document.createElement("div");w.className="wait";const one=ser.map(s=>s.v.filter(v=>v!=null).pop()).filter(v=>v!=null);w.innerHTML=(one.length?"<b style=\\"color:var(--parchment);font-size:18px\\">"+format(one.reduce((a,b)=>a+b,0))+"</b><br>":"")+(n?"Collecting: the chart draws itself as the days come in.":"Nothing in this range.");box.appendChild(w);return}
  const W=box.clientWidth,H=box.clientHeight,L=34,R=8,T=12,B=22,pw=W-L-R,ph=H-T-B;
  const tot=(i)=>ser.reduce((a,s)=>a+(s.v[i]||0),0);
  let hi=0,lo=Infinity;for(let i=0;i<n;i++){if(type==="bars")hi=Math.max(hi,tot(i));else for(const s of ser){const v=s.v[i];if(v!=null){hi=Math.max(hi,v);lo=Math.min(lo,v)}}for(const s of ov)if(s.v[i]!=null)hi=Math.max(hi,s.v[i])}
  let y;if(invert){lo=Math.max(1,Math.floor(lo*.92));hi=Math.ceil(hi*1.05);if(hi<=lo)hi=lo+1;y=(v)=>T+ph*(v-lo)/(hi-lo)}else{hi=nice(hi*1.08);y=(v)=>T+ph*(1-v/hi)}
  const x=type==="bars"?(i)=>L+(i+.5)*pw/n:(i)=>L+(n===1?pw/2:i*pw/(n-1));
  const svg=el("svg",{viewBox:"0 0 "+W+" "+H,role:"img"},box),defs=el("defs",{},svg);
  const g=el("g",{class:"grid"},svg);
  const short=(v)=>v>=1000?(v/1000).toLocaleString("en-GB",{maximumFractionDigits:1})+"k":nf(v);
  for(const f of [0,.5,1]){const v=invert?lo+(hi-lo)*(1-f):hi*f;el("line",{x1:L,x2:W-R,y1:y(v),y2:y(v),"stroke-dasharray":f?"3 4":""},g);const t=el("text",{x:L-8,y:y(v)+4,"text-anchor":"end"},svg);t.textContent=(invert?"#":"")+short(v)}
  const ticks=Math.min(n,W<420?3:5);for(let k=0;k<ticks;k++){const i=ticks===1?0:Math.round(k*(n-1)/(ticks-1));const t=el("text",{x:x(i),y:H-5,"text-anchor":ticks>1&&k===0?"start":ticks>1&&k===ticks-1?"end":"middle"},svg);t.textContent=lab[i]}
  // (the releases: a gold mark on their day)
  const at={};for(const m of marks||[]){const i=m.i-off;if(i<0||i>=n)continue;(at[i]=at[i]||[]).push(m.text)}
  for(const i in at){el("line",{x1:x(+i),x2:x(+i),y1:T,y2:T+ph,stroke:"#f2c14e","stroke-dasharray":"2 3",opacity:.45},svg);el("circle",{cx:x(+i),cy:T-3,r:3.2,fill:"#f2c14e"},svg)}
  if(type==="bars"){
    const bw=Math.max(2,Math.min(16,pw/n*.6));
    for(let i=0;i<n;i++){let acc=0;ser.forEach((s)=>{const v=s.v[i]||0;if(!v)return;const y0=y(acc),y1=y(acc+v);acc+=v;el("rect",{x:x(i)-bw/2,y:y1,width:bw,height:Math.max(1,y0-y1),rx:Math.min(2.5,bw/4),fill:s.color,opacity:pl[i]?.45:.92,stroke:"#15161c","stroke-width":bw>5?1:0},svg)})}
  }
  const path=(s,k,fill)=>{const gid="g"+box.id+k;if(fill){const lg=el("linearGradient",{id:gid,x1:0,y1:0,x2:0,y2:1},defs);el("stop",{offset:"0","stop-color":s.color,"stop-opacity":.28},lg);el("stop",{offset:"1","stop-color":s.color,"stop-opacity":0},lg)}
    let run=[];const runs=[];s.v.forEach((v,i)=>{if(v==null){if(run.length)runs.push(run);run=[]}else run.push([x(i),y(v)])});if(run.length)runs.push(run);
    for(const r of runs){if(r.length===1){el("circle",{cx:r[0][0],cy:r[0][1],r:3,fill:s.color},svg);continue}const d=smooth(r);if(fill)el("path",{d:d+"L"+r[r.length-1][0]+","+(T+ph)+"L"+r[0][0]+","+(T+ph)+"Z",fill:"url(#"+gid+")"},svg);el("path",{d,fill:"none",stroke:s.color,"stroke-width":2,"stroke-linejoin":"round","stroke-linecap":"round"},svg)}};
  if(type!=="bars")ser.forEach((s,k)=>path(s,k,type==="area"));
  ov.forEach((s,k)=>path(s,"o"+k,false));
  // (the value under the finger or the mouse)
  const line=el("line",{y1:T,y2:T+ph,stroke:"rgb(242 193 78/.35)","stroke-width":1,opacity:0},svg);
  const lined=type==="bars"?ov:[...ser,...ov];
  const dots=lined.map(s=>el("circle",{r:4,fill:s.color,stroke:"#0b0c10","stroke-width":2,opacity:0},svg));
  const tip=document.createElement("div");tip.className="tip";box.appendChild(tip);
  const row=(s,v)=>"<div><span><i style=\\"background:"+s.color+"\\"></i>"+s.name+"</span><span>"+format(v)+"</span></div>";
  const show=(ev)=>{const r=box.getBoundingClientRect();const px=ev.clientX-r.left;let i=type==="bars"?Math.floor((px-L)/(pw/n)):Math.round((px-L)/(pw/(n-1||1)));i=Math.max(0,Math.min(n-1,i));
    line.setAttribute("x1",x(i));line.setAttribute("x2",x(i));line.setAttribute("opacity",1);
    lined.forEach((s,k)=>{const v=s.v[i];if(v==null){dots[k].setAttribute("opacity",0);return}dots[k].setAttribute("cx",x(i));dots[k].setAttribute("cy",y(v));dots[k].setAttribute("opacity",1)});
    const sc=since&&take(since)[i];
    tip.innerHTML="<b>"+lab[i]+(sc?" <span style=\\"color:var(--faint);font-weight:400\\">≈ shared since "+sc+"</span>":pl[i]?" <span style=\\"color:var(--faint);font-weight:400\\">CurseForge alone</span>":"")+"</b>"+ser.filter(s=>s.v[i]!=null).map(s=>row(s,s.v[i])).join("")+(type==="bars"&&ser.length>1?"<div style=\\"border-top:1px solid var(--edge);margin-top:4px;padding-top:4px\\"><span>Total</span><span>"+format(tot(i))+"</span></div>":"")+ov.filter(s=>s.v[i]!=null).map(s=>row(s,s.v[i])).join("")+(at[i]?"<div style=\\"color:var(--gold);margin-top:4px\\">"+at[i].join(" · ")+"</div>":"");
    tip.classList.add("on");const tw=tip.offsetWidth;tip.style.left=Math.max(0,Math.min(W-tw,x(i)+(x(i)>W/2?-tw-12:12)))+"px";tip.style.top=T+"px"};
  const hide=()=>{tip.classList.remove("on");line.setAttribute("opacity",0);dots.forEach(d=>d.setAttribute("opacity",0))};
  box.onpointermove=show;box.onpointerdown=show;box.onpointerleave=hide;
}
function spark(box,values,color,whole){if(!box)return;box.innerHTML="";const v=whole?values:cut(values);const pts=v.map((y,i)=>[i,y]).filter(p=>p[1]!=null);if(pts.length<2)return;
  const W=box.clientWidth,H=box.clientHeight,hi=Math.max(...pts.map(p=>p[1]))||1,n=v.length;const X=(i)=>2+i*(W-4)/(n-1),Y=(y)=>H-3-(H-6)*y/hi;
  const svg=el("svg",{viewBox:"0 0 "+W+" "+H},box),gid="s"+(box.id||Math.random().toString(36).slice(2)),lg=el("linearGradient",{id:gid,x1:0,y1:0,x2:0,y2:1},el("defs",{},svg));el("stop",{offset:"0","stop-color":color,"stop-opacity":.3},lg);el("stop",{offset:"1","stop-color":color,"stop-opacity":0},lg);
  const p=pts.map(([i,y])=>[X(i),Y(y)]),d=smooth(p);el("path",{d:d+"L"+p[p.length-1][0]+","+H+"L"+p[0][0]+","+H+"Z",fill:"url(#"+gid+")"},svg);el("path",{d,fill:"none",stroke:color,"stroke-width":1.6},svg);el("circle",{cx:p[p.length-1][0],cy:p[p.length-1][1],r:2.6,fill:color},svg)}
const legend=(box,series,onToggle)=>{if(!box)return;box.innerHTML=series.map((s,k)=>"<span data-k=\\""+k+"\\" style=\\"cursor:pointer;opacity:"+(s.off?.35:1)+"\\"><i style=\\"background:"+s.color+"\\"></i>"+s.name+(s.sum!=null?" <b style=\\"color:var(--parchment);font-weight:500\\">"+nf(s.sum)+"</b>":"")+"</span>").join("");box.querySelectorAll("span").forEach(sp=>sp.onclick=()=>onToggle(+sp.dataset.k))};
let addons,dlTotal,sites,colorOf;
function readSeries(){
  addons=D.downloads.addons.map((a,k)=>({name:a,color:C[k%C.length],values:D.downloads.daily[a],off:hidden("hiddenAddons").includes(a)}));
  colorOf=Object.fromEntries(addons.map(a=>[a.name,a.color]));
  dlTotal=D.days.map((_,i)=>{let t=null;for(const a of addons){const v=a.values[i];if(v!=null)t=(t||0)+v}return t});
  sites=Object.entries(D.sites).map(([s,v],k)=>({name:s,color:C[(k+1)%C.length],v,off:hidden("hiddenSites").includes(s)}));
}
readSeries();
const pct=(cur,was)=>was==null||cur==null?null:was===0?(cur>0?"new":null):Math.round(100*(cur-was)/was);
const delta=(p)=>p==null?"":p==="new"?"<span class=\\"dl up\\">new</span>":"<span class=\\"dl "+(p<0?"down":"up")+"\\">"+(p<0?"−":"+")+Math.abs(p)+"%</span>";
const hours=()=>D.hourly.hours.map(h=>new Date(h).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}));
/** An addon's downloads in the range and in the span before: the hours' when 24 h (CurseForge's readings), the days' else. */
function inRange(a){if(hourly()){const h=D.hourly.series[a];return h?[total(h.slice(24)),total(h.slice(0,24))]:[null,null]}const [x,y]=span(),p=prior(),v=D.downloads.daily[a]||[];return [total(v.slice(x,y)),p?total(v.slice(p[0],p[1])):null]}
const marks=()=>D.marks.map(m=>({i:D.days.indexOf(m.day),text:m.text})).filter(m=>m.i>=0);
function tile(id,label,v,d,extra){const t=$(id);if(!t)return;t.querySelector(".k").textContent=label;t.querySelector(".v").innerHTML=v;t.querySelector(".d").innerHTML=(extra||"")+(d||"&nbsp;")}
function tiles(){
  const [a,b]=span(),p=prior();
  // downloads in the range, against the span before
  let cur,was;if(hourly()){const h=Object.values(D.hourly.series);cur=total(h.map(s=>total(s.slice(24))));was=total(h.map(s=>total(s.slice(0,24))))}else{cur=total(dlTotal.slice(a,b));was=p?total(dlTotal.slice(p[0],p[1])):null}
  const ch=pct(cur,was);
  tile("t-dl","Downloads, "+rangeName(),nf(cur),hourly()?"CurseForge's readings, hour by hour":ch==null?(range==="0"?"since "+(D.labels[a]||"–"):"nothing to compare before"):(ch==="new"?"<b class=\\"up\\">new</b>":"<b class=\\""+(ch<0?"down":"up")+"\\">"+(ch<0?"▼ ":"▲ ")+Math.abs(ch)+"%</b>")+" on the "+rangeName()+" before");
  // different people: CurseForge's own, over 7, 30 or 90 days only (a sum of days would count a person each day)
  const per=D.periods[range]&&Object.keys(D.periods[range]).length?D.periods[range]:null;
  tile("t-pp","Different people"+(per?", "+rangeName():""),per?nf(Object.values(per).reduce((t,c)=>t+c.unique,0)):"–",per?"CurseForge, each addon's own: one person on two counts twice":"CurseForge counts people over 7, 30 or 90 days");
  // the best day (hour), and what was released on it
  let best=-1,bi=-1;const vals=hourly()?D.hourly.hours.map((_,i)=>total(Object.values(D.hourly.series).map(s=>s[i]))).slice(24):dlTotal.slice(a,b);vals.forEach((v,i)=>{if(v!=null&&v>best){best=v;bi=i}});
  const rel=!hourly()&&bi>=0?marks().filter(m=>m.i===a+bi).map(m=>m.text):[];
  tile("t-best",hourly()?"Best hour":"Best day",bi<0?"–":nf(best),bi<0?"":(hourly()?hours().slice(24)[bi]:D.labels[a+bi])+(rel.length?" · "+rel[0]+(rel.length>1?" +"+(rel.length-1):""):""));
  // the stores' shares
  if(hourly())tile("t-st","Stores","CurseForge","Hour by hour, CurseForge alone: Wago and GitHub are daily totals");
  else{const sums=D.stores.map(x=>({...x,n:total(D.downloads.stores[x.key].slice(a,b))||0}));const all=sums.reduce((t,x)=>t+x.n,0)||1;
    tile("t-st","Stores","<span class=\\"split\\">"+sums.map(x=>"<i style=\\"width:"+(100*x.n/all)+"%;background:"+x.color+"\\"></i>").join("")+"</span>",sums.map(x=>x.name+" "+Math.round(100*x.n/all)+"%").join(" · "))}
  const label=hourly()?"The last 24 hours":D.labels[a]?(a===b-1?D.labels[a]:D.labels[a]+" – "+D.labels[b-1]):"Nothing in this range";
  $("range-label").textContent=label;if($("dl-span"))$("dl-span").textContent=label;
  if($("k-dl-r"))$("k-dl-r").textContent=cur!=null?"+"+nf(cur)+" in "+(range==="0"?"all":rangeName()):"";
}
// The leaderboard: the range's column filled, sorted by a column, six then all.
let sortBy=["name","range","people","all"].includes(prefs.sort)?prefs.sort:"range",lbAll=false;
function board(){
  const body=document.querySelector("#download-rows tbody");if(!body)return;
  const per=D.periods[range];const rows=[...body.rows];const key={};
  for(const tr of rows){const a=tr.dataset.a,[cur,was]=inRange(a),pp=per&&per[a]?per[a].unique:null;
    tr.querySelector(".rg").innerHTML=cur==null?"–":"<b>"+nf(cur)+"</b>"+delta(pct(cur,was));
    tr.querySelector(".pp").textContent=pp==null?"–":nf(pp);
    const sp=tr.querySelector(".sp");sp.innerHTML="<div style=\\"width:66px;height:24px\\"></div>";
    const v=hourly()?D.hourly.series[a]&&D.hourly.series[a].slice(24):D.downloads.daily[a]&&cut(D.downloads.daily[a]);if(v)spark(sp.firstChild,v,colorOf[a]||"#6f6a5e",true);
    key[a]={name:a,range:cur??-1,people:pp??-1,all:+tr.dataset.all}}
  rows.sort((x,y)=>{const a=key[x.dataset.a],b=key[y.dataset.a];if((a.all<0)!==(b.all<0))return a.all<0?1:-1;return sortBy==="name"?a.name.localeCompare(b.name):b[sortBy]-a[sortBy]||b.all-a.all});
  rows.forEach((tr,i)=>{body.appendChild(tr);tr.classList.toggle("cut",!lbAll&&i>=6)});
  document.querySelectorAll("#download-rows th[data-sort]").forEach(th=>th.classList.toggle("on",th.dataset.sort===sortBy));
  if($("lb-range"))$("lb-range").textContent=range==="0"?"All":range==="c"?"Range":rangeName();
  const m=$("lb-more");if(m){m.hidden=rows.length<=6;m.textContent=lbAll?"Show fewer":"Show all "+rows.length}
}
let mode=prefs.downloads==="unique"?"unique":"all";
let view=["addon","store","lines"].includes(prefs.view)?prefs.view:"addon";
let siteMode=prefs.sites==="pageviews"?"pageviews":"visitors";
function chips(){const box=$("chips-dl");if(!box)return;box.hidden=view==="store"&&mode==="all"&&!hourly();
  box.innerHTML=addons.map((a,k)=>"<button class=\\"chip"+(a.off?" off":"")+"\\" data-k=\\""+k+"\\"><i style=\\"background:"+a.color+"\\"></i>"+a.name+"</button>").join("")+"<button class=\\"chip all\\" data-k=\\"all\\">All</button><button class=\\"chip all\\" data-k=\\"none\\">None</button>";
  box.querySelectorAll("button").forEach(b=>b.onclick=()=>{const k=b.dataset.k;if(k==="all"||k==="none")addons.forEach(a=>a.off=k==="none");else addons[+k].off=!addons[+k].off;remember("hiddenAddons",addons.filter(a=>a.off).map(a=>a.name));draw()})}
function draw(){
  spark($("k-dl"),dlTotal,C[0]);spark($("k-in"),D.installs,C[1]);spark($("k-fa"),D.facts,C[2]);spark($("k-vi"),D.visitors,C[4]);
  document.querySelectorAll("[data-range]").forEach(b=>b.classList.toggle("on",b.dataset.range===range));
  $("custom").hidden=range!=="c";if(range==="c"){$("from").value=from||"";$("to").value=to||""}
  document.querySelectorAll(".daily-note").forEach(p=>p.hidden=!hourly());
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===view));
  document.querySelectorAll("[data-site]").forEach(b=>b.classList.toggle("on",b.dataset.site===siteMode));
  tiles();board();chips();
  const on=addons.filter(a=>!a.off);
  // (the downloads: hour by hour at 24 h, else the days; all of them, by store, or the different people)
  if(hourly()&&mode==="all"){const hl=hours().slice(24);chart($("c-dl"),{type:view==="lines"?"lines":"bars",whole:true,series:on.filter(a=>D.hourly.series[a.name]).map(a=>({...a,values:D.hourly.series[a.name].slice(24)})),labels:hl})}
  else if(mode==="unique")chart($("c-dl"),{type:"bars",series:on.map(a=>({...a,values:D.unique[a.name]||D.days.map(()=>null)})),labels:D.labels});
  else if(view==="store")chart($("c-dl"),{type:"bars",series:D.stores.map(x=>({name:x.name,color:x.color,values:D.downloads.stores[x.key]})),labels:D.labels,since:D.since,pale:D.downloads.early,marks:marks()});
  else chart($("c-dl"),{type:view==="lines"?"lines":"bars",series:on,labels:D.labels,since:view==="lines"?null:D.since,pale:D.downloads.early,marks:marks()});
  chart($("c-rk"),{type:"lines",invert:true,trim:true,format:(v)=>v==null?"–":"#"+nf(v),series:Object.keys(D.rank).filter(a=>!addons.find(x=>x.name===a&&x.off)).map((a,k)=>({name:a,color:colorOf[a]||C[k%C.length],values:D.rank[a]})),labels:D.labels});
  const inw=[{name:"Running that day",color:C[1],values:D.installs}],over=[{name:"Different over 7 days",color:C[0],values:D.installsWeek}];
  chart($("c-in"),{type:"bars",trim:true,series:inw,over,labels:D.labels});legend($("l-in"),[...inw,...over],()=>{});
  const fa=[{name:"Facts",color:C[2],values:D.facts},{name:"New observations archived",color:C[0],values:D.newFacts}];
  chart($("c-fa"),{type:"area",trim:true,series:fa,labels:D.labels});legend($("l-fa"),fa,()=>{});
  if($("c-vi")){const ss=sites.map(s=>({...s,values:s.v[siteMode],sum:total(cut(s.v[siteMode]))}));chart($("c-vi"),{type:"area",trim:true,series:ss.filter(s=>!s.off),labels:D.labels});legend($("l-vi"),ss,(k)=>{sites[k].off=!sites[k].off;remember("hiddenSites",sites.filter(s=>s.off).map(s=>s.name));draw()})}
  fitAll();
}
const setMode=(m)=>{mode=m;document.body.classList.toggle("dl-u",m==="unique");document.querySelectorAll("[data-dl]").forEach(b=>b.classList.toggle("on",b.dataset.dl===m))};
setMode(mode);
// (the controls by delegation: a part brought fresh by the refresh keeps working)
document.addEventListener("click",(e)=>{const b=e.target.closest("button,th");if(!b)return;const d=b.dataset;
  if(d.range){range=d.range;remember("range",range);if(range==="c"&&!(from&&to)){const [a,c]=span();from=D.days[a]||D.days[0];to=D.days[c-1]||D.days.at(-1)}draw()}
  else if(d.dl){setMode(d.dl);remember("downloads",mode);draw()}
  else if(d.view){view=d.view;remember("view",view);draw()}
  else if(d.site){siteMode=d.site;remember("sites",siteMode);draw()}
  else if(d.sort){sortBy=d.sort;remember("sort",sortBy);board()}
  else if(b.id==="lb-more"){lbAll=!lbAll;board()}});
["from","to"].forEach(id=>$(id).onchange=()=>{const v=$(id).value;if(id==="from")from=v;else to=v;if(from&&to&&from>to)[from,to]=[to,from];remember("from",from);remember("to",to);draw()});
let t;new ResizeObserver(()=>{clearTimeout(t);t=setTimeout(draw,60)}).observe(document.querySelector("main"));draw();

// The scroll panels (the activity, the comments): five rows, then a peek of the sixth and a scroll.
function fit(box,sel,k){if(!box)return;box.style.maxHeight="";box.classList.remove("fade","end");const rows=[...box.querySelectorAll(sel)].filter(r=>!r.hidden);
  if(rows.length<=k)return;const top=box.getBoundingClientRect().top;box.style.maxHeight=Math.ceil(rows[k-1].getBoundingClientRect().bottom-top+28)+"px";box.classList.add("fade");
  box.onscroll=()=>box.classList.toggle("end",box.scrollTop+box.clientHeight>=box.scrollHeight-4)}
function fitAll(){fit($("feed-scroll"),".feed li",5);fit($("threads-scroll"),".thread",5)}

// The activity: its filters, a long word opened.
let filter=["all","data","problems","comments","digests"].includes(prefs.activity)?prefs.activity:"all";let items=[];const opened=new Set();
const apply=()=>{document.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("on",b.dataset.filter===filter));for(const li of items)li.hidden=!(filter==="all"||li.dataset.group===filter);if($("feed-scroll"))$("feed-scroll").scrollTop=0;fitAll()};
document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;remember("activity",filter);apply()});
function bindFeed(){
  items=[...document.querySelectorAll(".feed li")];
  document.querySelectorAll(".feed .b").forEach(b=>{const at=b.closest("li").dataset.at;if(opened.has(at))b.classList.add("open");b.onclick=()=>{b.classList.toggle("open");b.classList.contains("open")?opened.add(at):opened.delete(at)}});
  for(const li of items)li.hidden=!(filter==="all"||li.dataset.group===filter);
  document.querySelectorAll("[data-filter]").forEach(b=>b.classList.toggle("on",b.dataset.filter===filter));fitAll();
}
bindFeed();

// The comments: the ones to answer, or all.
let threadsShown=null;
const showThreads=(k)=>{threadsShown=k;let shown=0;document.querySelectorAll(".thread").forEach(t=>{t.hidden=k==="open"&&t.dataset.open!=="1";if(!t.hidden)shown++});
  document.querySelectorAll("[data-threads]").forEach(b=>b.classList.toggle("on",b.dataset.threads===k));
  if($("no-open"))$("no-open").hidden=!(k==="open"&&!shown&&document.querySelector(".thread"));fitAll()};
function bindThreads(){
  document.querySelectorAll("[data-threads]").forEach(b=>b.onclick=()=>{remember("threads",b.dataset.threads);showThreads(b.dataset.threads)});
  const firstOn=document.querySelector("[data-threads].on");if(firstOn)showThreads(threadsShown??(["open","all"].includes(prefs.threads)?prefs.threads:firstOn.dataset.threads));
}
bindThreads();

// Everything kept current in place, the page never reloaded: every half
// minute while it's shown, at once when it comes back (the app on a phone:
// iOS keeps it as it was left), on a pull at the top and with the refresh
// button. A comment being read, a filter, a word opened stay as they were.
const PARTS=["#hero","#side-standing","#nav-answer",".kpis","#to-day","#daily-snapshot","#feed","#threads","#comments .chips","#download-rows","#dl-note","#downloads-checked","#unique-through","#download-popularity","#download-releases","#addons-body","#players","#sites","#notif-count"];
let refreshing=false,freshAt=Date.now();
const fresh=()=>{const s=Math.round((Date.now()-freshAt)/1000);if($("fresh"))$("fresh").textContent=" · updated "+(s<20?"just now":s<90?s+" s ago":Math.round(s/60)+" min ago")};
setInterval(fresh,10000);fresh();
async function refresh(by){
  if(refreshing||(!by&&document.visibilityState!=="visible"))return;
  refreshing=true;const spin=[$("refresh"),$("pull")].filter(Boolean);spin.forEach(x=>x.classList.add("busy"));
  const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),15000);
  try{
    const res=await fetch(location.pathname+location.search,{cache:"no-store",signal:abort.signal});
    const page=new DOMParser().parseFromString(await res.text(),"text/html");const data=page.getElementById("data");
    if(!res.ok||!data){if(by)location.reload();return} // (signed out: the page says so)
    // (a scroll panel read halfway stays where it was)
    const kept=Object.fromEntries([...document.querySelectorAll(".scroll[id]")].map(x=>[x.id,x.scrollTop]));
    for(const selector of PARTS){const before=document.querySelector(selector),after=page.querySelector(selector);if(before&&after&&before.innerHTML!==after.innerHTML)before.innerHTML=after.innerHTML}
    D=JSON.parse(data.textContent);readSeries();draw();bindFeed();bindThreads();for(const id in kept)if($(id))$(id).scrollTop=kept[id];freshAt=Date.now();fresh();
  }catch{if(by==="button")location.reload()}finally{clearTimeout(timeout);refreshing=false;spin.forEach(x=>x.classList.remove("busy"))}
}
setInterval(()=>refresh(),30000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&Date.now()-freshAt>10000)refresh("focus")});
addEventListener("pageshow",(e)=>{if(e.persisted)refresh("focus")});
if($("refresh"))$("refresh").onclick=()=>refresh("button");
{const pull=$("pull");let y0=null,dy=0;
  addEventListener("touchstart",(e)=>{y0=scrollY<=0&&e.touches.length===1?e.touches[0].clientY:null;dy=0},{passive:true});
  addEventListener("touchmove",(e)=>{if(y0===null)return;dy=Math.max(0,e.touches[0].clientY-y0);pull.classList.add("held");pull.style.transform="translateY("+(Math.min(dy,110)*0.7-60)+"px) rotate("+dy*2+"deg)";pull.classList.toggle("ready",dy>90)},{passive:true});
  addEventListener("touchend",()=>{if(y0===null)return;pull.classList.remove("held");pull.style.transform="";pull.classList.remove("ready");if(dy>90)refresh("button");y0=null;dy=0})}

// The nav: where the page is (the last part whose top has passed a third of
// the screen, the last part once at the bottom); a part clicked stays marked
// while the page scrolls to it, until the reader scrolls on their own.
const ids=["overview",...[...document.querySelectorAll("main > section[id]")].map(s=>s.id)];
const links=[...document.querySelectorAll("[data-nav]")];const mark=(id)=>links.forEach(a=>a.classList.toggle("on",a.dataset.nav===id));
let pinned=null,frame=0;
const where=()=>{if(pinned)return mark(pinned);const line=innerHeight/3;let cur=ids[0];for(const id of ids)if($(id).getBoundingClientRect().top<=line)cur=id;
  if(innerHeight+scrollY>=document.documentElement.scrollHeight-4)cur=ids[ids.length-1];mark(cur)};
links.forEach(a=>a.addEventListener("click",()=>{pinned=a.dataset.nav;mark(pinned)}));
["wheel","touchmove","keydown"].forEach(ev=>addEventListener(ev,()=>{pinned=null},{passive:true}));
addEventListener("scroll",()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(where)},{passive:true});where();
})();

// The notifications' switch (Hearthtale's lib/push.ts, without React).
(()=>{
const KEY=${JSON.stringify(key)};
const $=(id)=>document.getElementById(id);
const bytes=(s)=>{const b=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))};
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)&&!(matchMedia("(display-mode: standalone)").matches||navigator.standalone);
const supported="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
const reg=()=>navigator.serviceWorker.register("/sw.js").then(()=>navigator.serviceWorker.ready);
const sw=$("push-switch"),state=$("push-state"),test=$("push-test");
async function draw(){
  sw.disabled=true;test.hidden=true;
  if(ios){state.textContent="On an iPhone: Share, then Add to Home Screen, and open Ravenpost from there.";return}
  if(!supported){state.textContent="This browser can't receive notifications.";return}
  if(!KEY){state.textContent="Not set up on the inbox yet (its VAPID keys).";return}
  if(Notification.permission==="denied"){state.textContent="Blocked for this site in the browser's settings.";return}
  const sub=await (await reg()).pushManager.getSubscription();
  sw.disabled=false;sw.setAttribute("aria-checked",!!sub);test.hidden=!sub;
  state.textContent=sub?"On: the data jobs as they finish, and the morning's digest.":"Off.";
}
async function on(){
  try{
    if(await Notification.requestPermission()!=="granted")return draw();
    const r=await reg();
    const sub=(await r.pushManager.getSubscription())||(await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(KEY)}));
    const res=await fetch("/api/push/subscriptions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(sub.toJSON())});
    if(!res.ok)throw new Error(res.status);
  }catch(e){state.textContent="That didn't work ("+e.message+"). Try again."}
  draw();
}
async function off(){
  const sub=await (await reg()).pushManager.getSubscription();
  if(sub){await fetch("/api/push/subscriptions",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe()}
  draw();
}
sw.onclick=()=>(sw.getAttribute("aria-checked")==="true"?off():on());
test.onclick=async()=>{const r=await (await fetch("/api/push/test",{method:"POST"})).json();state.textContent="Sent to "+r.sent+" device"+(r.sent===1?"":"s")+"."};
draw();
})();
</script>`;
