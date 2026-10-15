import { describe, expect, test } from "bun:test";
import { dashboard, hourlyOf, seriesOf, withDownloadReadings } from "../src/dashboard";
import type { Reading } from "../src/curseforge";
import type { History } from "../src/stats";

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
    expect(html).toContain('class="tot">178<');
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

  test("comments are last, with a shortcut still available on mobile", () => {
    const html = dashboard(history);
    const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
    const sections = [...main.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(["activity", "downloads", "players", "sites", "notifications", "comments"]);
    const mobile = html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/)![1];
    expect(mobile).toContain('href="#comments"');
    expect([...mobile.matchAll(/data-nav="([^"]+)"/g)].at(-1)?.[1]).toBe("comments");
  });
});
