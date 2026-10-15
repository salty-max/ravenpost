import type { Day, History } from "./stats";

/**
 * The dashboard (/stats), drawn here: no script, the charts plain SVG, in
 * Ravenpost's look (night stone, gold, Cinzel and Inter). Totals are as of
 * the latest day; the charts the last 60 days.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (n: number | undefined) => (n === undefined ? "–" : n.toLocaleString("en-GB"));
const sum = (o: Record<string, number | undefined> | undefined) => Object.values(o ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
const COLORS = ["#d4a843", "#7fb3d5", "#9fd18b", "#e08a6e", "#c39bd3", "#e8dcc2", "#76d7c4"];

type Series = { name: string; points: (number | undefined)[] };

/** A line chart of several series over the same days. */
function lines(days: string[], series: Series[], height = 180): string {
  const W = 640, H = height, L = 48, B = 22, T = 10;
  const values = series.flatMap((s) => s.points.filter((v): v is number => v !== undefined));
  if (!values.length || days.length < 1) return `<p class="empty">Nothing yet.</p>`;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => L + (days.length === 1 ? (W - L) / 2 : (i * (W - L - 8)) / (days.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / span);
  const grid = [lo, lo + span / 2, hi]
    .map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${fmt(Math.round(v))}</text>`)
    .join("");
  const labels = [0, days.length - 1]
    .filter((i, k, a) => a.indexOf(i) === k)
    .map((i) => `<text x="${x(i)}" y="${H - 4}" class="axis" text-anchor="${i === 0 ? "start" : "end"}">${days[i].slice(5)}</text>`)
    .join("");
  const paths = series
    .map((s, k) => {
      const pts = s.points.map((v, i) => (v === undefined ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
      const dot = pts.length === 1 ? `<circle cx="${pts[0]!.split(",")[0]}" cy="${pts[0]!.split(",")[1]}" r="3" fill="${COLORS[k % COLORS.length]}"/>` : "";
      return `<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[k % COLORS.length]}" stroke-width="2"/>${dot}`;
    })
    .join("");
  const legend = series.map((s, k) => `<span><i style="background:${COLORS[k % COLORS.length]}"></i>${esc(s.name)}</span>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${paths}${labels}</svg><div class="legend">${legend}</div>`;
}

/** Bars, one a day. */
function bars(days: string[], values: (number | undefined)[], height = 140): string {
  if (!values.some((v) => v)) return `<p class="empty">Nothing yet.</p>`;
  const W = 640, H = height, L = 48, B = 22, T = 10;
  const hi = Math.max(...values.map((v) => v ?? 0)) || 1;
  const w = (W - L) / days.length;
  const rects = values
    .map((v, i) => {
      const h = ((H - T - B) * (v ?? 0)) / hi;
      return `<rect x="${L + i * w + w * 0.15}" y="${H - B - h}" width="${w * 0.7}" height="${h}" class="bar"><title>${days[i]}: ${fmt(v)}</title></rect>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><line x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}" class="grid"/><text x="${L - 6}" y="${T + 8}" class="axis" text-anchor="end">${fmt(hi)}</text>${rects}<text x="${L}" y="${H - 4}" class="axis">${days[0]?.slice(5) ?? ""}</text><text x="${W}" y="${H - 4}" class="axis" text-anchor="end">${days[days.length - 1]?.slice(5) ?? ""}</text></svg>`;
}

const tiles = (items: [string, string][]) =>
  `<div class="tiles">${items.map(([v, l]) => `<div class="tile"><b>${v}</b><span>${esc(l)}</span></div>`).join("")}</div>`;
const table = (head: string[], rows: string[][]) =>
  `<div class="scroll"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
const shares = (m: Record<string, number> | undefined) =>
  Object.entries(m ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${esc(k)} <b>${fmt(v)}</b>`)
    .join(" · ") || "–";

export function dashboard(h: History, opts: { viewer?: string } = {}): string {
  const all = Object.keys(h.days).sort();
  const days = all.slice(-60);
  const get = <K extends keyof Day>(k: K) => days.map((d) => h.days[d]?.[k]);
  const latest = <K extends keyof Day>(k: K): Day[K] | undefined => {
    for (let i = all.length - 1; i >= 0; i--) if (h.days[all[i]]?.[k]) return h.days[all[i]][k];
    return undefined;
  };
  // (the count a week before the latest, else the oldest one there is: "since" it)
  const base = <K extends keyof Day>(k: K, ago: number): { day: string; value: Day[K] } | undefined => {
    const have = all.filter((d) => h.days[d]?.[k]);
    if (have.length < 2) return undefined;
    const last = have[have.length - 1];
    const cut = new Date(new Date(last).getTime() - ago * 86_400_000).toISOString().slice(0, 10);
    const day = [...have].reverse().find((d) => d <= cut) ?? have[0];
    return day === last ? undefined : { day, value: h.days[day][k] };
  };
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const since = (d: string) => `${Number(d.slice(8))} ${months[Number(d.slice(5, 7)) - 1]}`;

  // Downloads
  const dl = latest("downloads") ?? {};
  const week = base("downloads", 7);
  const dl7 = week?.value ?? {};
  const weekLabel = week ? (new Date(all[all.length - 1]).getTime() - new Date(week.day).getTime() >= 7 * 86_400_000 ? "7 days" : `since ${since(week.day)}`) : "7 days";
  const addons = Object.keys(dl).sort((a, b) => sum(dl[b]) - sum(dl[a]));
  const dlRows = addons.map((a) => {
    const t = sum(dl[a]);
    const prev = dl7[a] ? sum(dl7[a]) : undefined;
    return [esc(a), fmt(dl[a].curseforge), fmt(dl[a].wago), fmt(dl[a].github), `<b>${fmt(t)}</b>`, prev === undefined ? "–" : `+${fmt(t - prev)}`];
  });
  const dlSeries = addons.map((a) => ({ name: a, points: get("downloads").map((d) => (d?.[a] ? sum(d[a]) : undefined)) }));

  // Ravenpost
  const rp = get("ravenpost");
  const rpLast = latest("ravenpost");
  // Sharing
  const sh = get("sharing");
  const shLast = latest("sharing");
  const merged = latest("merged");
  // Traffic
  const tr = get("traffic");
  const sites = [...new Set(tr.flatMap((t) => Object.keys(t ?? {})))];

  const total = sum(Object.fromEntries(addons.map((a) => [a, sum(dl[a])])));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ravenpost's numbers</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#16130f;--panel:#201b15;--line:#3a3127;--gold:#d4a843;--text:#e8dcc2;--dim:#a99c84;--faint:#7a6f5d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 60px}
h1,h2{font-family:Cinzel,serif;color:var(--gold);font-weight:600;margin:0}h1{font-size:28px}h2{font-size:18px;margin-bottom:12px}
header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:22px}header p{margin:0;color:var(--dim);font-size:13px}
section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:18px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}
.tiles{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}.tile{background:#0003;border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:120px}
.tile b{display:block;font-size:22px;color:var(--gold)}.tile span{font-size:12px;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:14px}th{color:var(--dim);font-weight:600;text-align:left;border-bottom:1px solid var(--line);padding:6px 4px;white-space:nowrap}
td{padding:6px 4px;border-bottom:1px solid #ffffff0d}.n{text-align:right;font-variant-numeric:tabular-nums}
.chart{width:100%;height:auto;margin-top:6px}.grid{stroke:var(--line)}.axis{fill:var(--faint);font-size:11px}.bar{fill:var(--gold);opacity:.85}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--dim);margin-top:4px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.empty{color:var(--faint);font-size:13px;margin:6px 0}.note{color:var(--faint);font-size:12px;margin:8px 0 0}a{color:var(--gold)}
.mix{font-size:13px;color:var(--dim);margin:4px 0}.mix b{color:var(--text)}
.scroll{overflow-x:auto}
@media (max-width:560px){main{padding:20px 12px 40px}section{padding:14px 12px}h1{font-size:22px}th,td{padding:5px 3px;font-size:13px}.tile{min-width:0;flex:1 1 40%}.tile b{font-size:19px}.grid2{grid-template-columns:1fr}}
</style></head><body><main>
<header><h1>Ravenpost's numbers</h1><p>${h.updated ? `Updated ${esc(h.updated.slice(0, 16).replace("T", " "))} UTC` : "No numbers yet"}${opts.viewer ? ` · ${esc(opts.viewer)}` : ""}</p></header>

<section><h2>Downloads</h2>
${tiles([
  [fmt(total), "downloads, every addon and channel"],
  ...(week ? ([[fmt(sum(Object.fromEntries(addons.map((a) => [a, dl7[a] ? sum(dl[a]) - sum(dl7[a]) : 0])))), weekLabel === "7 days" ? "in the last 7 days" : weekLabel]] as [string, string][]) : []),
])}
${table(["Addon", "CurseForge", "Wago", "GitHub", "Total", weekLabel], dlRows)}
${lines(days, dlSeries)}
<p class="note">Download events, not players. CurseForge through cfwidget, Wago from its pages, GitHub from the releases.</p></section>

<div class="grid2">
<section><h2>Ravenpost</h2>
${tiles([[fmt(rpLast?.installs), "installs active (last day)"], [fmt(rpLast?.sharing), "sharing"], [fmt(rpLast?.linked?.hearthtale), "linked to Hearthtale"]])}
${bars(days, rp.map((r) => r?.installs))}
<p class="mix">Versions: ${shares(rpLast?.versions)}</p><p class="mix">Systems: ${shares(rpLast?.os)}</p><p class="mix">Linked: ${shares(rpLast?.linked)}</p>
<p class="note">One anonymous ping an install a day.</p></section>

<section><h2>Sharing</h2>
${tiles([[fmt(shLast?.sharers), "players sharing (last day)"], [fmt(shLast?.facts), "facts sent"], [fmt(sum(Object.fromEntries(Object.entries(merged ?? {}).map(([g, m]) => [g, m.newFacts])))), "new to the database (last merge)"]])}
${bars(days, sh.map((s) => s?.facts))}
<p class="mix">Games: ${shares(shLast?.games)}</p><p class="mix">Languages: ${shares(shLast?.locales)}</p>
<p class="note">Facts a day; new ones as wow-data's daily merge counts them.</p></section>
</div>

<section><h2>The sites</h2>
${sites.length ? lines(days, sites.map((s) => ({ name: `${s} visitors`, points: tr.map((t) => t?.[s]?.visitors) }))) : `<p class="empty">No traffic numbers yet: Web Analytics feeds them once its token is set. Meanwhile, <a href="https://vercel.com/jellycat/hearthtale/analytics">Hearthtale's analytics on Vercel</a>.</p>`}
</section>
</main></body></html>`;
}
