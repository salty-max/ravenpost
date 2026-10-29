import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Release } from "../src/curseforge";
import { addonsSection } from "../src/dashboard";
import { behind, checks, githubLatest, lookGitHub, newer, setLaunchFetch, watch } from "../src/launch";
import type { History, Today } from "../src/stats";

beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "launch-"));
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  setLaunchFetch((i, o) => fetch(i, o));
});

const rel = (version: string, at = "2026-11-04T08:00:00Z"): Release => ({ id: 1, version, at, downloads: 0, type: 1 });
const h = (installs: number, sharers: number): History => ({
  days: { "2026-11-03": { ravenpost: { installs, versions: {}, os: {}, linked: {}, sharing: 0 }, sharing: { sharers, uploads: 0, facts: 0, games: {}, locales: {} } } },
});
const today = (installs: number, sharers: number): Today => ({ at: "x", day: "2026-11-04", installs, sharing: 0, sharers, uploads: 0, facts: 0 });
const evening = new Date("2026-11-04T19:00:00Z");
const noon = new Date("2026-11-04T12:00:00Z");

describe("the launch watch", () => {
  test("versions compare by x.y.z, whatever surrounds them", () => {
    expect(newer("v0.15.0", "0.14.2 (Classic)")).toBe(true);
    expect(newer("v0.14.2", "Yonder 0.14.2")).toBe(false);
    expect(newer("nightly", "0.1.0")).toBe(false);
  });

  test("a quiet evening warns, a quiet noon doesn't, a doubling is good news", () => {
    expect(checks(h(100, 50), today(30, 40), {}, {}, evening).find((c) => c.id === "pings")?.level).toBe("warn");
    expect(checks(h(100, 50), today(30, 40), {}, {}, noon).find((c) => c.id === "pings")?.level).toBe("ok");
    expect(checks(h(100, 50), today(10, 5), {}, {}, evening).find((c) => c.id === "uploads")?.level).toBe("warn");
    expect(checks(h(100, 50), today(250, 40), {}, {}, noon).map((c) => c.id)).toContain("spike");
    // (too few yesterday to judge)
    expect(checks(h(2, 1), today(0, 0), {}, {}, evening).every((c) => c.level === "ok")).toBe(true);
  });

  test("a GitHub release CurseForge hasn't passed in six hours warns", () => {
    const gh = { Yonder: { tag: "v0.15.0", at: "2026-11-04T08:00:00Z", url: "https://github.com/salty-max/yonder/releases/tag/v0.15.0" } };
    const cf = { Yonder: [rel("0.14.2")] };
    expect(behind(gh.Yonder, cf.Yonder, Date.parse("2026-11-04T10:00:00Z"))?.hours).toBe(2);
    expect(checks(h(0, 0), today(0, 0), gh, cf, noon).some((c) => c.id.startsWith("drift-yonder"))).toBe(false);
    expect(checks(h(0, 0), today(0, 0), gh, cf, evening).some((c) => c.id === "drift-yonder-v0.15.0")).toBe(true);
    expect(behind(gh.Yonder, [rel("0.15.0")])).toBeNull();
  });

  test("each warning is told once a day", async () => {
    const list = checks(h(100, 50), today(30, 40), {}, {}, evening);
    expect(await watch(list, evening)).toEqual(["pings"]);
    expect(await watch(list, evening)).toEqual([]);
    expect(await watch(list, new Date(evening.getTime() + 25 * 3600_000))).toEqual(["pings"]);
  });

  test("GitHub's latest releases are kept, a refusal keeps the last", async () => {
    setLaunchFetch(async (url) => (url.includes("/yonder/") ? Response.json({ tag_name: "v0.15.0", published_at: "2026-11-04T08:00:00Z", html_url: "https://github.com/salty-max/yonder/releases/tag/v0.15.0" }) : new Response("", { status: 404 })));
    expect((await lookGitHub()).Yonder.tag).toBe("v0.15.0");
    setLaunchFetch(async () => new Response("", { status: 403 }));
    await lookGitHub();
    expect((await githubLatest()).Yonder.tag).toBe("v0.15.0");
  });

  test("the Addons section shows each store and the watch", () => {
    const html = addonsSection(h(100, 50), today(30, 40), { Yonder: { tag: "v0.15.0", at: "2026-11-04T08:00:00Z", url: "https://github.com/salty-max/yonder/releases/tag/v0.15.0" } }, { Yonder: [rel("0.14.2", "2026-10-22T08:00:00Z")] }, [], evening.getTime());
    expect(html).toContain("Launch watch");
    expect(html).toContain("Ravenpost pings are down");
    expect(html).toContain("CurseForge 11 h behind");
    expect(html).toContain("v0.15.0");
  });
});
