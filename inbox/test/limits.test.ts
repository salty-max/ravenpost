import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "../src/app";
import { subOf, tokenFor } from "../src/auth";
import { addressOf, distinct, hit, resetLimits } from "../src/ratelimit";
import { collect, countToday, history, ping, readPing, record, setStatsFetch } from "../src/stats";
import * as store from "../src/store";

beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "limits-"));
  resetLimits();
  setStatsFetch(async () => new Response("", { status: 404 }));
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  delete process.env.INBOX_DIR;
  delete process.env.FACTS_MAX_UPLOADS;
  delete process.env.PING_READ_CAP;
  resetLimits();
  setStatsFetch((input, init) => fetch(input, init));
});

const id = (n: number) => n.toString(16).padStart(32, "0");
const pingFrom = (ip: string, n: number) =>
  app.request("/api/ping", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ id: id(n), os: "windows" }) });

describe("the limits", () => {
  test("a window: so many hits, then refused until it's over", () => {
    expect([1, 2, 3].map(() => hit("t", "k", 2, 60_000, 0))).toEqual([true, true, false]);
    expect(hit("t", "other", 2, 60_000, 0)).toBe(true);
    expect(hit("t", "k", 2, 60_000, 60_001)).toBe(true);
  });

  test("so many different values a day, the same one again always fine, a new day afresh", () => {
    expect(["a", "b", "a", "c"].map((v) => distinct("t", "k", v, 2, "2026-10-15"))).toEqual([true, true, true, false]);
    expect(distinct("t", "k", "c", 2, "2026-10-16")).toBe(true);
  });

  test("an address hashed, an IPv6 one by its /64", () => {
    const of = (ip: string) => addressOf((h) => (h === "x-forwarded-for" ? ip : undefined));
    expect(of("2001:db8:1:2::1")).toBe(of("2001:0db8:1:2:ffff:ffff:ffff:ffff"));
    expect(of("2001:db8:1:2::1")).not.toBe(of("2001:db8:1:3::1"));
    expect(of("1.2.3.4")).not.toBe(of("1.2.3.5"));
    expect(of("1.2.3.4")).not.toContain("1.2.3.4");
  });

  test("the ping: an install pinging again is fine, a flood from one address is refused", async () => {
    for (let i = 0; i < 5; i++) expect((await pingFrom("1.2.3.4", 1)).status).toBe(200);
    let refused = 0;
    for (let i = 2; i < 40; i++) if ((await pingFrom("1.2.3.4", i)).status === 429) refused++;
    expect(refused).toBeGreaterThan(0);
    // (someone else, elsewhere, still counts)
    expect((await pingFrom("5.6.7.8", 99)).status).toBe(200);
    // (and what was refused never reached the store)
    expect((await store.all(`pings/${new Date().toISOString().slice(0, 10)}/`)).length).toBe(7);
  });

  test("facts: a sharer's day has a cap, checked before anything is written", async () => {
    process.env.FACTS_MAX_UPLOADS = "2";
    const t = tokenFor({ sub: subOf(7), tag: "Max#1234" });
    const body = JSON.stringify({ game: "forever", facts: { deDE: { quest: { "1": { title: "Eins" } } } } });
    const send = () => app.request("/api/facts", { method: "POST", headers: { authorization: `Bearer ${t}` }, body });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect((await store.all("inbox/forever/")).length).toBe(2);
  });
});

describe("the cron's reads", () => {
  test("today's sharing installs are read once an hour, not every ten minutes", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    await ping(readPing({ id: id(1), version: "0.5.1", os: "darwin", arch: "arm64", linked: [], sharing: 1 })!, now);
    expect((await countToday(now)).sharing).toBe(1);
    // (the same install stops sharing: the count keeps last hour's until the hour is up, the installs are live)
    await ping(readPing({ id: id(1), version: "0.5.1", os: "darwin", arch: "arm64", linked: [], sharing: 0 })!, now);
    await ping(readPing({ id: id(2), version: "0.5.1", os: "darwin", arch: "arm64", linked: [], sharing: 0 })!, now);
    const soon = await countToday(new Date(now.getTime() + 10 * 60_000));
    expect([soon.installs, soon.sharing]).toEqual([2, 1]);
    expect((await countToday(new Date(now.getTime() + 61 * 60_000))).sharing).toBe(0);
  });

  test("a day too big to read whole: sampled, still recorded, the files gone", async () => {
    process.env.PING_READ_CAP = "50";
    const day = new Date("2026-10-15T12:00:00Z");
    for (let i = 0; i < 300; i++) await ping(readPing({ id: id(i), version: "0.5.1", os: "windows", arch: "amd64", linked: [], sharing: 0 })!, day);
    const h = await collect(new Date("2026-10-16T05:17:00Z"));
    expect(h.days["2026-10-15"].ravenpost).toMatchObject({ installs: 300, sampled: true });
    expect(h.days["2026-10-15"].ravenpost!.os.windows).toBe(50);
    expect(await store.all("pings/2026-10-15/")).toEqual([]);
  });

  test("a deadline reached: yesterday left whole for the next run, its files kept", async () => {
    const day = new Date("2026-10-15T12:00:00Z");
    await ping(readPing({ id: id(1), version: "0.5.1", os: "darwin", arch: "arm64", linked: [], sharing: 0 })!, day);
    const h = await collect(new Date("2026-10-16T05:17:00Z"), 0);
    expect(h.days["2026-10-15"]?.ravenpost).toBeUndefined();
    expect((await store.all("pings/2026-10-15/")).length).toBe(1);
    expect((await collect(new Date("2026-10-16T05:30:00Z"))).days["2026-10-15"].ravenpost?.installs).toBe(1);
  });

  test("leftovers of a day already counted go, the count stays", async () => {
    await record({ "2026-10-12": { ravenpost: { installs: 5000, versions: {}, os: {}, linked: {}, sharing: 0 } } });
    await ping(readPing({ id: id(1), version: "0.5.1", os: "darwin", arch: "arm64", linked: [], sharing: 0 })!, new Date("2026-10-12T12:00:00Z"));
    const h = await collect(new Date("2026-10-16T05:17:00Z"));
    expect(h.days["2026-10-12"].ravenpost?.installs).toBe(5000);
    expect(await store.all("pings/2026-10-12/")).toEqual([]);
  });

  test("a day the job missed is counted late, not lost, and its files go", async () => {
    await ping(readPing({ id: id(1), version: "0.5.1", os: "darwin", arch: "arm64", linked: [], sharing: 0 })!, new Date("2026-10-12T12:00:00Z"));
    await collect(new Date("2026-10-16T05:17:00Z"));
    expect((await history()).days["2026-10-12"].ravenpost).toMatchObject({ installs: 1, os: { darwin: 1 } });
    expect((await history()).days["2026-10-12"].ravenpost?.distinct).toBeUndefined();
    expect(await store.all("pings/2026-10-12/")).toEqual([]);
  });
});
