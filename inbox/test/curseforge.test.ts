import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { latest, look, readings, setCurseForgeFetch } from "../src/curseforge";
import { hourlyOf } from "../src/dashboard";
import { digestOf } from "../src/digest";
import * as events from "../src/events";

let files: Record<number, { id: number; displayName: string; dateCreated: string; totalDownloads: number; releaseType: number }[]> = {};
beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "cf-"));
  files = { 1728396: [{ id: 1, displayName: "v0.10.1", dateCreated: "2026-10-14T15:56:51Z", totalDownloads: 43, releaseType: 1 }] };
  setCurseForgeFetch(async (url) => Response.json({ data: files[Number(url.match(/mods\/(\d+)\//)![1])] ?? [] }));
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  setCurseForgeFetch((input, init) => fetch(input, init));
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
});
