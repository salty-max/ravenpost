import { describe, expect, test } from "bun:test";
import { dashboard, hourlyOf, seriesOf, withDownloadReadings } from "../src/dashboard";
import type { Reading } from "../src/curseforge";
import { ADDONS, type History } from "../src/stats";

describe("the dashboard's current downloads", () => {
  const history: History = {
    days: {
      "2026-10-14": { downloads: { Yonder: { curseforge: 100, wago: 40, github: 10 }, Keyring: { curseforge: 50 }, Ravenpost: { github: 5 } } },
      "2026-10-15": { downloads: { Yonder: { curseforge: 110, wago: 41, github: 12 } }, downloadsAt: "2026-10-15T05:17:00Z", sharing: { sharers: 1, uploads: 2, facts: 9, games: {}, locales: {} } },
    },
  };
  const readings: Reading[] = [
    ["2026-10-15T10:30:00Z", { Yonder: 125 }],
    ["2026-10-14T23:50:00Z", { Yonder: 100, Keyring: 50 }],
    ["2026-10-15T10:00:00Z", { Yonder: 120, Keyring: 55 }],
    ["2026-10-15T10:10:00Z", { Keyring: 55 }],
  ];

  test("the total, per-addon rows and daily chart use the fresh count without losing other stores", () => {
    const before = JSON.stringify(history);
    const current = withDownloadReadings(history, readings);
    expect(current.days["2026-10-15"].downloads?.Yonder).toEqual({ curseforge: 125, wago: 41, github: 12 });
    expect(current.days["2026-10-15"].sharing?.facts).toBe(9);
    const s = seriesOf(current);
    expect(s.downloads.totals).toEqual({ Yonder: 178, Keyring: 55, Ravenpost: 5 });
    expect(s.downloads.daily.Yonder).toEqual([null, 28]);
    expect(s.downloads.week.Yonder).toBe(28);
    const html = dashboard(history, { readings });
    expect(html).toContain('class="v">238<');
    expect(html).toContain('<td class="num tot">178<');
    expect(JSON.stringify(history)).toBe(before);
  });

  test("a partial or older reading cannot replace a newer known count with less", () => {
    const current = withDownloadReadings(history, [
      ["2026-10-13T10:00:00Z", { Yonder: 500 }],
      ["2026-10-15T03:00:00Z", { Yonder: 105 }],
      ["invalid", { Yonder: 999 }],
      ["2026-10-15T10:00:00Z", { Yonder: -1, Keyring: NaN }],
    ]);
    expect(current.days["2026-10-15"].downloads?.Yonder).toEqual({ curseforge: 110, wago: 41, github: 12 });
    expect(current.days["2026-10-13"]).toBeUndefined();
  });

  test("a fresh reading can extend an old history, or introduce an addon before the daily job", () => {
    const current = withDownloadReadings(history, [["2026-10-16T00:10:00Z", { Yonder: 130, "Second Wind": 3 }]]);
    expect(seriesOf(current).downloads.totals.Yonder).toBe(183);
    expect(seriesOf(current).downloads.totals["Second Wind"]).toBe(3);
    expect(seriesOf(current).days.at(-1)).toBe("2026-10-16");
    expect(dashboard(history, { readings: [["2026-10-16T00:10:00Z", { Yonder: 130 }]] })).toContain("To 16 Oct");
    expect(seriesOf(withDownloadReadings({ days: {} }, [["2026-10-16T00:10:00Z", { Yonder: 130 }]])).downloads.totals.Yonder).toBe(130);
  });

  test("fresh source corrections are used, rather than freezing the count at an older higher value", () => {
    const current = withDownloadReadings(history, [
      ["2026-10-15T10:00:00Z", { Yonder: 120 }],
      ["2026-10-15T10:10:00Z", { Yonder: 115 }],
      ["2026-10-15T10:20:00Z", { Yonder: 116 }],
    ]);
    expect(current.days["2026-10-15"].downloads?.Yonder).toEqual({ curseforge: 116, wago: 41, github: 12 });
  });

  test("a daily source failure keeps the last available count for the other channels", () => {
    const s = seriesOf({ days: {
      "2026-10-14": { downloads: { Yonder: { curseforge: 100, wago: 40, github: 10 } } },
      "2026-10-15": { downloads: { Yonder: { github: 12 } } },
    } });
    expect(s.downloads.channels.Yonder).toEqual({ curseforge: 100, wago: 40, github: 12 });
    expect(s.downloads.daily.Yonder).toEqual([null, 2]);
    expect(s.downloads.week.Yonder).toBe(2);
  });

  test("a failed addon in one poll keeps today's count and the next hourly change", () => {
    const h = hourlyOf(readings, Date.parse("2026-10-15T11:00:00Z"));
    expect(h.today).toBe(30);
    expect(h.series.Yonder.filter((n) => n !== null).reduce((a, b) => a + b, 0)).toBe(25);
    expect(h.series.Keyring.filter((n) => n !== null).reduce((a, b) => a + b, 0)).toBe(5);
  });

  test("the other stores' counts from the ten-minute look move the totals too", () => {
    const current = withDownloadReadings(history, [["2026-10-15T10:30:00Z", { Yonder: 125 }, { Yonder: { wago: 44 }, Ravenpost: { github: 9 } }]]);
    expect(current.days["2026-10-15"].downloads?.Yonder).toEqual({ curseforge: 125, wago: 44, github: 12 });
    expect(seriesOf(current).downloads.totals.Ravenpost).toBe(9);
  });

  test("today's installs and facts so far beside yesterday's", () => {
    const html = dashboard(history, { today: { at: "2026-10-15T10:00:00Z", day: "2026-10-15", installs: 3, sharing: 1, sharers: 1, uploads: 2, facts: 40 } });
    expect(html).toContain("yesterday · <b>3</b> today so far");
    expect(html).toContain("yesterday · <b>40</b> today so far");
  });

  test("comments come before the notifications, with a shortcut still available on mobile", () => {
    const html = dashboard(history);
    const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
    const sections = [...main.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(["activity", "downloads", "addons", "players", "sites", "comments", "notifications"]);
    const side = html.match(/<nav class="nav">([\s\S]*?)<\/nav>/)![1];
    expect([...side.matchAll(/data-nav="([^"]+)"/g)].map((m) => m[1]).slice(-2)).toEqual(["comments", "notifications"]);
    const mobile = html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/)![1];
    expect(mobile).toContain('href="#comments"');
    expect([...mobile.matchAll(/data-nav="([^"]+)"/g)].at(-1)?.[1]).toBe("comments");
  });
});

test("downloads lists every addon, counted or not", () => {
  const html = dashboard({ days: { "2026-10-28": { downloads: { Yonder: { curseforge: 5 } } } } } as any, {});
  const rows = html.slice(html.indexOf('id="download-rows"'), html.indexOf('id="downloads-checked"'));
  expect(rows.length).toBeGreaterThan(100);
  for (const [name] of ADDONS) expect(rows).toContain(name);
  expect(rows).toContain('data-a="Goodwill" data-all="-1"');
});

test("today's visitors so far reach the sites chart before the daily job sums them", () => {
  const today = { at: "2026-10-29T10:00:00Z", day: "2026-10-29", installs: 0, sharing: 0, sharers: 0, uploads: 0, facts: 0, traffic: { hearthtale: { pageviews: 9, visitors: 4 } } };
  const html = dashboard({ days: { "2026-10-28": { traffic: { hearthtale: { pageviews: 5, visitors: 2 } } } } } as any, { today, now: Date.parse("2026-10-29T10:05:00Z") });
  expect(html).toContain('"visitors":[2,4]');
  expect(html).toContain("<b>4</b> today so far");
});

describe("the series' earlier days and stores", () => {
  const h: History = {
    days: {
      "2026-10-11": { unique: { Yonder: { downloads: 7, unique: 5 }, Keyring: { downloads: 2, unique: 2 } } },
      "2026-10-12": { unique: { Yonder: { downloads: 9, unique: 6 } } },
      "2026-10-13": { downloads: { Yonder: { curseforge: 100, wago: 1, github: 10 } }, unique: { Yonder: { downloads: 11, unique: 8 } } },
      "2026-10-14": { downloads: { Yonder: { curseforge: 120, wago: 2, github: 13 } }, unique: { Yonder: { downloads: 30, unique: 20 } }, curseforge: { Yonder: { rank: 300 } }, ravenpost: { installs: 3, versions: {}, os: {}, linked: {}, sharing: 0, distinct: { week: 5, month: 5, ever: 5, newWeek: null, newMonth: null, since: "2026-10-14" } } },
      "2026-10-16": { downloads: { Yonder: { curseforge: 140, wago: 2, github: 15 } }, curseforge: { Yonder: { rank: 280 } } },
    },
  };
  const s = seriesOf(h);

  test("before the first counted difference, CurseForge's own daily count fills in, said early", () => {
    expect(s.days).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(s.downloads.daily.Yonder).toEqual([7, 9, 11, 24, 11, 11]);
    expect(s.downloads.early).toEqual([true, true, true, false, false, false]);
  });

  test("an addon with no total at all is left out, its statistics only kept for Unique", () => {
    expect(s.downloads.addons).toEqual(["Yonder"]);
    expect(s.unique.Keyring).toEqual([2, 0, 0, 0, null, null]);
  });

  test("each store's new downloads a day, a gap shared like the totals", () => {
    expect(s.downloads.stores.curseforge).toEqual([7, 9, 11, 20, 10, 10]);
    expect(s.downloads.stores.wago).toEqual([null, null, null, 1, 0, 0]);
    expect(s.downloads.stores.github).toEqual([null, null, null, 3, 1, 1]);
  });

  test("the rank and the week's different installs, a day", () => {
    expect(s.rank.Yonder).toEqual([null, null, null, 300, null, 280]);
    expect(s.installsWeek).toEqual([null, null, null, 5, null, null]);
  });

  test("a newer addon's own early days don't mark the days others counted whole", () => {
    const later = seriesOf({ days: { ...h.days, "2026-10-15": { unique: { Mealbook: { downloads: 4, unique: 4 } } }, "2026-10-16": { downloads: { ...h.days["2026-10-16"].downloads, Mealbook: { curseforge: 4 } } } } });
    expect(later.downloads.daily.Mealbook.slice(4)).toEqual([4, null]);
    expect(later.downloads.early.slice(3)).toEqual([false, false, false]);
  });
});
