import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "../src/app";
import { sign, subOf, tokenFor } from "../src/auth";
import { dashboard, seriesOf } from "../src/dashboard";
import { collect, countToday, countUpload, history, ping, readPing, readUnique, record, setStatsFetch, today, uniquePeriods } from "../src/stats";

beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "stats-"));
  process.env.INBOX_TOKEN = "t0ken";
  setStatsFetch(async (url) => {
    if (url.startsWith("https://api.cfwidget.com/")) return Response.json({ downloads: { total: 100 } });
    if (url.includes("addons.wago.io/addons/yonder")) return new Response('{"id":"ZKbq5y61","download_count":42}');
    if (url.includes("addons.wago.io")) return new Response("<html>another addon</html>");
    if (url.includes("api.github.com")) return Response.json([{ assets: [{ download_count: 7 }, { download_count: 3 }] }]);
    if (url === "https://api.curseforge.com/v1/mods") return Response.json({ data: [{ id: 1728396, gamePopularityRank: 14410, favoriteCount: 3, thumbsUpCount: 1 }] });
    return new Response("", { status: 404 });
  });
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  delete process.env.INBOX_TOKEN;
  setStatsFetch((input, init) => fetch(input, init));
});

describe("the numbers", () => {
  test("a ping: an install's random id, its version, system and links, nothing else", () => {
    expect(readPing({ id: "x" })).toBeNull();
    const p = readPing({ id: "a".repeat(32), version: "0.4.0", os: "darwin", arch: "arm64", linked: ["hearthtale", "evil"], sharing: 2, name: "Max" });
    expect(p).toEqual({ id: "a".repeat(32), version: "0.4.0", os: "darwin", arch: "arm64", linked: ["hearthtale"], sharing: 2 });
  });

  test("a day: pings and uploads counted, then the files go; downloads as of the morning", async () => {
    const day = new Date("2026-10-15T12:00:00Z");
    const next = new Date("2026-10-16T05:17:00Z");
    await ping(readPing({ id: "a".repeat(32), version: "0.4.0", os: "darwin", arch: "arm64", linked: ["hearthtale", "shared"], sharing: 1 })!, day);
    await ping(readPing({ id: "a".repeat(32), version: "0.4.0", os: "darwin", arch: "arm64", linked: ["hearthtale", "shared"], sharing: 1 })!, day);
    await ping(readPing({ id: "b".repeat(32), version: "0.3.0", os: "windows", arch: "amd64", linked: [], sharing: 0 })!, day);
    await countUpload("sub-1", "forever", { enUS: 10, deDE: 5 }, day);
    await countUpload("sub-1", "forever", { enUS: 2 }, day);
    await countUpload("sub-2", "classic", { frFR: 4 }, day);
    const h = await collect(next);
    expect(h.days["2026-10-15"].ravenpost).toEqual({
      installs: 2,
      versions: { "0.4.0": 1, "0.3.0": 1 },
      os: { darwin: 1, windows: 1 },
      linked: { hearthtale: 1, shared: 1 },
      sharing: 1,
    });
    expect(h.days["2026-10-15"].sharing).toEqual({ sharers: 2, uploads: 3, facts: 21, games: { forever: 17, classic: 4 }, locales: { enUS: 12, deDE: 5, frFR: 4 } });
    expect(h.days["2026-10-16"].downloads!.Yonder).toEqual({ curseforge: 100, wago: 42, github: 10 });
    expect(h.days["2026-10-16"].downloadsAt).toBe(next.toISOString());
    expect(h.days["2026-10-16"].downloads!.Hearthtale).toEqual({ curseforge: 100, github: 10 });
    expect(h.days["2026-10-16"].downloads!.Ravenpost).toEqual({ github: 10 });
    // (no CurseForge key, no standing; with it, each addon's rank, favorites, thumbs up)
    expect(h.days["2026-10-16"].curseforge).toBeUndefined();
    process.env.CURSEFORGE_API_KEY = "k";
    try {
      expect((await collect(next)).days["2026-10-16"].curseforge).toEqual({ Yonder: { rank: 14410, favorites: 3, likes: 1 } });
    } finally {
      delete process.env.CURSEFORGE_API_KEY;
    }
    // Run again: the day's numbers stay.
    const again = await collect(next);
    expect(again.days["2026-10-15"].ravenpost!.installs).toBe(2);
    expect(again.days["2026-10-15"].sharing!.facts).toBe(21);
  });

  test("an upload counts on its sharer's line for the day", async () => {
    const t = tokenFor({ sub: subOf(7), tag: "Max#1234" });
    const body = { game: "forever", facts: { deDE: { quest: { "1": { title: "Eins" }, "2": { title: "Zwei" } } } } };
    await app.request("/api/facts", { method: "POST", headers: { authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
    const h = await collect(new Date(Date.now() + 86_400_000));
    const day = new Date().toISOString().slice(0, 10);
    expect(h.days[day].sharing).toMatchObject({ sharers: 1, uploads: 1, facts: 2, locales: { deDE: 2 } });
  });

  test("the routes: a ping from anyone, the job and the merge's numbers behind their tokens", async () => {
    expect((await app.request("/api/ping", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await app.request("/api/ping", { method: "POST", body: JSON.stringify({ id: "c".repeat(32), os: "linux" }) })).status).toBe(200);
    expect((await app.request("/api/cron/stats")).status).toBe(401);
    expect((await app.request("/api/cron/stats", { headers: { authorization: "Bearer t0ken" } })).status).toBe(200);
    const merged = { days: { "2026-10-15": { merged: { forever: { uploads: 3, newFacts: 12 } } } } };
    expect((await app.request("/api/inbox/stats", { method: "POST", body: JSON.stringify(merged) })).status).toBe(401);
    const res = await app.request("/api/inbox/stats", { method: "POST", headers: { authorization: "Bearer t0ken" }, body: JSON.stringify(merged) });
    expect(res.status).toBe(200);
    expect((await history()).days["2026-10-15"].merged).toEqual({ forever: { uploads: 3, newFacts: 12 } });
    expect((await app.request("/api/inbox/stats", { method: "POST", headers: { authorization: "Bearer t0ken" }, body: '{"days":{"yesterday":{}}}' })).status).toBe(400);
  });

  test("the dashboard: its owner's only", async () => {
    process.env.STATS_BATTLETAGS = "Namzar#21586";
    try {
      // (a stranger: the sign-in page, Battle.net or a phone's code)
      expect(await (await app.request("/stats")).text()).toContain("/api/login?web=1");
      const stranger = sign({ tag: "Someone#1", exp: Math.floor(Date.now() / 1000) + 60 });
      const theirs = await (await app.request("/stats", { headers: { cookie: `rp_stats=${stranger}` } })).text();
      expect(theirs).toContain("Sign in with Battle.net");
      expect(theirs).not.toContain("Downloads");
      const owner = sign({ tag: "namzar#21586", exp: Math.floor(Date.now() / 1000) + 60 });
      const res = await app.request("/stats", { headers: { cookie: `rp_stats=${owner}` } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="downloads"');
    } finally {
      delete process.env.STATS_BATTLETAGS;
    }
  });

  test("the dashboard's scripts parse (one slip there and nothing on the page answers)", () => {
    const html = dashboard({ days: { "2026-10-16": { downloads: { Yonder: { curseforge: 1 } } } } }, { pushKey: "k", events: [] });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new Function(code)).not.toThrow();
  });

  test("the dashboard draws an empty history and a full one", () => {
    expect(dashboard({ days: {} })).toContain("Nothing yet");
    const html = dashboard({
      updated: "2026-10-16T05:17:00Z",
      days: {
        "2026-10-13": { downloads: { Yonder: { curseforge: 90, wago: 40, github: 8 } } },
        "2026-10-16": { downloads: { Yonder: { curseforge: 100, wago: 42, github: 10 } }, ravenpost: { installs: 2, versions: { "0.4.0": 2 }, os: { darwin: 2 }, linked: { hearthtale: 2 }, sharing: 1 } },
      },
    });
    expect(html).toContain('class="v">152<');
    expect(html).toContain('id="data"');
  });

  test("the charts' numbers: every day, downloads a day from the totals, a gap said", () => {
    const s = seriesOf({
      days: {
        "2026-10-13": { downloads: { Yonder: { curseforge: 90, wago: 40, github: 8 } } },
        "2026-10-15": { downloads: { Yonder: { curseforge: 95, wago: 40, github: 8 } }, traffic: { hearthtale: { pageviews: 9, visitors: 4 } } },
        "2026-10-16": { downloads: { Yonder: { curseforge: 100, wago: 42, github: 10 } }, ravenpost: { installs: 2, versions: {}, os: {}, linked: {}, sharing: 1 } },
      },
    });
    expect(s.days).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(s.downloads.daily.Yonder).toEqual([null, 2.5, 2.5, 9]); // (the gap's 5, shared over its two days)
    expect(s.downloads.since).toEqual([null, "2026-10-13", "2026-10-13", null]);
    expect(s.downloads.week.Yonder).toBe(14);
    expect(s.installs).toEqual([null, null, null, 2]);
    expect(s.sites.hearthtale.visitors).toEqual([null, null, 4, null]);
  });
});

describe("today so far, and the unique downloaders", () => {
  test("today's installs and facts counted before the daily job, another day's not shown", async () => {
    const now = new Date("2026-10-19T10:00:00Z");
    await ping(readPing({ id: "a".repeat(32), version: "0.4.0", os: "darwin", arch: "arm64", linked: [], sharing: 1 })!, now);
    await ping(readPing({ id: "b".repeat(32), version: "0.4.0", os: "windows", arch: "x64", linked: [], sharing: 0 })!, now);
    await ping(readPing({ id: "c".repeat(32), version: "0.4.0", os: "windows", arch: "x64", linked: [], sharing: 0 })!, new Date("2026-10-18T10:00:00Z"));
    await countUpload("someone", "forever", { enUS: 30 }, now);
    await countUpload("someone", "classic", { frFR: 5 }, now);
    expect(await countToday(now)).toMatchObject({ day: "2026-10-19", installs: 2, sharing: 1, sharers: 1, uploads: 2, facts: 35 });
    expect(await today(now)).toMatchObject({ installs: 2, facts: 35 });
    expect(await today(new Date("2026-10-20T00:05:00Z"))).toBeNull();
  });

  test("the unique downloaders: checked, into the history without moving its snapshot, the periods kept", async () => {
    expect(readUnique({ days: { "2026-10-18": { Yonder: { downloads: 5, unique: -1 } } }, periods: {} })).toBeNull();
    expect(readUnique({ days: { yesterday: {} }, periods: {} })).toBeNull();
    expect(readUnique({ days: {}, periods: { "365": {} } })).toBeNull();
    await record({ "2026-10-18": { merged: { forever: { uploads: 1, newFacts: 2 } }, downloads: { Yonder: { curseforge: 100 } } } });
    const updated = (await history()).updated;
    const body = { days: { "2026-10-17": { Yonder: { downloads: 46, unique: 30 } }, "2026-10-18": { Yonder: { downloads: 50, unique: 33 } } }, periods: { "7": { Yonder: { downloads: 359, unique: 217 } } } };
    process.env.UNIQUE_TOKEN = "un1que";
    expect((await app.request("/api/unique", { method: "POST", body: JSON.stringify(body) })).status).toBe(401);
    expect((await app.request("/api/unique", { method: "POST", headers: { authorization: "Bearer t0ken" }, body: JSON.stringify(body) })).status).toBe(401);
    const res = await app.request("/api/unique", { method: "POST", headers: { authorization: "Bearer un1que" }, body: JSON.stringify(body) });
    delete process.env.UNIQUE_TOKEN;
    expect(await res.json()).toEqual({ days: 2, through: "2026-10-18" });
    const h = await history();
    expect(h.updated).toBe(updated);
    expect(h.days["2026-10-18"]).toEqual({ merged: { forever: { uploads: 1, newFacts: 2 } }, downloads: { Yonder: { curseforge: 100 } }, unique: { Yonder: { downloads: 50, unique: 33 } } });
    expect(await uniquePeriods()).toMatchObject({ through: "2026-10-18", periods: { "7": { Yonder: { downloads: 359, unique: 217 } } } });
    expect(seriesOf(h).unique.Yonder).toEqual([30, 33]);
    const html = dashboard(h, { unique: await uniquePeriods() });
    expect(html).toContain("<b>217</b><span>of 359</span>");
    expect(html).toContain("<b>217</b> 7 d");
  });
});

describe("the store", () => {
  test("on this computer, a Blob token in the environment never sends a file to production", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake";
    try {
      await ping(readPing({ id: "d".repeat(32), version: "1", os: "linux", arch: "x", linked: [], sharing: 0 })!);
      const { readdirSync } = await import("node:fs");
      expect(readdirSync(path.join(process.env.INBOX_DIR!, "pings")).length).toBe(1);
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });
});
