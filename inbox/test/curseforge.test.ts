import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { latest, look, readings, releasesOf, setCurseForgeFetch } from "../src/curseforge";
import { hourlyOf } from "../src/dashboard";
import { digestOf } from "../src/digest";
import * as events from "../src/events";
import { setStatsFetch } from "../src/stats";

let files: Record<number, { id: number; displayName: string; dateCreated: string; totalDownloads: number; releaseType: number }[]> = {};
beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "cf-"));
  files = { 1728396: [{ id: 1, displayName: "v0.10.1", dateCreated: "2026-10-14T15:56:51Z", totalDownloads: 43, releaseType: 1 }] };
  setCurseForgeFetch(async (url) => Response.json({ data: files[Number(url.match(/mods\/(\d+)\//)![1])] ?? [] }));
  // (the other stores: Yonder's Wago page, Ravenpost's GitHub releases; nothing else answers)
  setStatsFetch(async (url) => {
    if (url.includes("addons.wago.io/addons/yonder")) return new Response('{"id":"ZKbq5y61","download_count":42}');
    if (url.includes("api.github.com/repos/salty-max/ravenpost/")) return Response.json([{ assets: [{ download_count: 7 }] }]);
    return new Response("", { status: 404 });
  });
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  setCurseForgeFetch((input, init) => fetch(input, init));
  setStatsFetch((input, init) => fetch(input, init));
});

describe("CurseForge's releases and downloads", () => {
  test("the first look learns; a new release is live, told; each look a reading", async () => {
    expect((await look(new Date("2026-10-15T10:00:00Z"))).live).toEqual([]);
    files[1728396] = [{ id: 2, displayName: "v0.11.0", dateCreated: "2026-10-15T10:10:00Z", totalDownloads: 2, releaseType: 1 }, ...files[1728396]];
    const r = await look(new Date("2026-10-15T10:30:00Z"));
    expect(r.live).toEqual(["Yonder v0.11.0 is live on CurseForge"]);
    expect((await events.recent())[0]).toMatchObject({ kind: "release", repo: "yonder", url: "https://www.curseforge.com/wow/addons/yonder/files" });
    expect((await latest()).Yonder.map((x) => x.version)).toEqual(["v0.11.0", "v0.10.1"]);
    expect((await readings("2026-10-15")).map(([at, t]) => [at, t.Yonder])).toEqual([
      ["2026-10-15T10:00:00.000Z", 43],
      ["2026-10-15T10:30:00.000Z", 45],
    ]);
    expect(digestOf({ days: {} }, await events.recent()).lines).toContain("Live on CurseForge: Yonder v0.11.0.");
  });

  test("each look reads Wago's counts beside, GitHub's once an hour", async () => {
    await look(new Date("2026-10-15T10:05:00Z"));
    await look(new Date("2026-10-15T10:25:00Z"));
    const [first, second] = await readings("2026-10-15");
    expect(first[2]).toEqual({ Yonder: { wago: 42 }, Ravenpost: { github: 7 } });
    expect(second[2]).toEqual({ Yonder: { wago: 42 } });
  });

  test("an addon with more releases than the dashboard keeps: none told twice, its name not in the version", async () => {
    files[1727545] = Array.from({ length: 26 }, (_, i) => ({ id: 100 + i, displayName: i < 20 ? `v0.${26 - i}.0` : `Lorekeeper's Codex 0.${26 - i}.0 (Classic)`, dateCreated: "2026-10-01T00:00:00Z", totalDownloads: 1, releaseType: 1 }));
    await look();
    expect((await look()).live).toEqual([]);
    expect((await look()).live).toEqual([]);
    files[1727545] = [{ id: 999, displayName: "Lorekeeper's Codex 0.27.0 (Forever)", dateCreated: "2026-10-16T00:00:00Z", totalDownloads: 0, releaseType: 1 }, ...files[1727545]];
    expect((await look()).live).toEqual(["Lorekeeper's Codex 0.27.0 (Forever) is live on CurseForge"]);
  });

  test("the last 48 hours: an hour's rise by addon, today's so far", () => {
    const now = Date.parse("2026-10-15T12:10:00Z");
    const h = hourlyOf(
      [
        ["2026-10-14T23:30:00Z", { Yonder: 40, Keyring: 5 }],
        ["2026-10-15T00:00:00Z", { Yonder: 41, Keyring: 5 }],
        ["2026-10-15T11:00:00Z", { Yonder: 45, Keyring: 6 }],
        ["2026-10-15T11:30:00Z", { Yonder: 47, Keyring: 6 }],
      ],
      now,
    );
    expect(h.hours.length).toBe(48);
    expect(h.series.Yonder[47 - 1]).toBe(6); // (11:00 to 11:59: 41 to 45, then 47)
    expect(h.series.Keyring[47 - 1]).toBe(1);
    expect(h.today).toBe(8); // (Yonder 40 to 47, Keyring 5 to 6)
  });

  test("all release pages contribute to the total, even though only twenty are displayed", async () => {
    files[1728396] = Array.from({ length: 57 }, (_, i) => ({ id: 1000 + i, displayName: `v0.0.${57 - i}`, dateCreated: "2026-10-14T00:00:00Z", totalDownloads: i + 1, releaseType: 1 }));
    const pages: number[] = [];
    setCurseForgeFetch(async (input) => {
      const u = new URL(input);
      const id = Number(u.pathname.match(/mods\/(\d+)\//)![1]);
      const index = Number(u.searchParams.get("pageIndex"));
      if (id === 1728396) pages.push(index);
      const all = files[id] ?? [];
      return Response.json({ data: all.slice(index * 50, (index + 1) * 50), pagination: { totalCount: all.length } });
    });
    await look(new Date("2026-10-15T10:00:00Z"));
    expect(pages).toEqual([0, 1]);
    expect((await readings("2026-10-15"))[0][1].Yonder).toBe(57 * 58 / 2);
    expect((await latest()).Yonder).toHaveLength(20);
    expect((await look()).live).toEqual([]);
  });

  test("a failed page or malformed response is not accepted as a smaller complete total", async () => {
    setCurseForgeFetch(async (input) => new URL(input).searchParams.get("pageIndex") === "0"
      ? Response.json({ data: Array.from({ length: 50 }, (_, i) => ({ id: i, displayName: "v1", dateCreated: "2026-10-15", totalDownloads: 1 })), pagination: { totalCount: 51 } })
      : new Response("Unavailable", { status: 503 }));
    await expect(releasesOf(1728396)).rejects.toThrow("503");
    setCurseForgeFetch(async () => Response.json({ error: "Unavailable" }));
    await expect(releasesOf(1728396)).rejects.toThrow("missing files");
  });
});
