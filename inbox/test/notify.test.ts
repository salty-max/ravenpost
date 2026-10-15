import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "../src/app";
import { sign } from "../src/auth";
import { digestOf } from "../src/digest";
import * as events from "../src/events";
import type { History } from "../src/stats";

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "notify-"));
  process.env.INBOX_TOKEN = "t0ken";
  process.env.INBOX_EVENTS_TOKEN = "ev3nts";
  process.env.WOWHEAD_TOKEN = "wh34d";
  process.env.STATS_BATTLETAGS = "Namzar#21586";
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  for (const k of ["INBOX_DIR", "INBOX_TOKEN", "INBOX_EVENTS_TOKEN", "WOWHEAD_TOKEN", "STATS_BATTLETAGS", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) delete process.env[k];
  globalThis.fetch = realFetch;
});

const owner = () => ({ cookie: `rp_stats=${sign({ tag: "Namzar#21586", exp: Math.floor(Date.now() / 1000) + 86400 })}` });
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("events", () => {
  test("a workflow's word, checked, kept and listed newest first", async () => {
    const e = { kind: "merged", repo: "yonder", title: "Yonder's game data updated", body: "German creature names: 12 new.", url: "https://github.com/salty-max/yonder/pull/3" };
    expect((await app.request("/api/events", json(e))).status).toBe(401);
    expect((await app.request("/api/events", json({ ...e, kind: "digest" }, { authorization: "Bearer ev3nts" }))).status).toBe(400);
    expect((await app.request("/api/events", json(e, { authorization: "Bearer ev3nts" }))).status).toBe(200);
    await app.request("/api/events", json({ ...e, kind: "failed", repo: "hearthtale", title: "Hearthtale's data job failed", url: "https://evil.example/x" }, { authorization: "Bearer ev3nts" }));
    const list = await events.recent();
    expect(list.map((x) => x.kind)).toEqual(["failed", "merged"]);
    expect(list[0].url).toBeUndefined(); // (links only to GitHub or the inbox)
  });

  test("the digest says what the jobs did and yesterday's numbers", () => {
    const h: History = {
      days: {
        "2026-10-15": {
          downloads: { Yonder: { curseforge: 100, wago: 10 }, Keyring: { curseforge: 5 } },
          ravenpost: { installs: 3, versions: {}, os: {}, linked: {}, sharing: 1 },
          sharing: { sharers: 1, uploads: 2, facts: 40, games: {}, locales: {} },
          traffic: { hearthtale: { pageviews: 300, visitors: 120 } },
        },
        "2026-10-16": { downloads: { Yonder: { curseforge: 120, wago: 12 }, Keyring: { curseforge: 5 } }, merged: { forever: { uploads: 2, newFacts: 12 } } },
      },
    };
    const ev = [
      { at: "2026-10-16T06:20:00Z", kind: "merged", repo: "yonder", title: "Yonder's game data updated", body: "" },
      { at: "2026-10-16T06:30:00Z", kind: "merged", repo: "lorekeepers-codex", title: "The Codex's game data updated", body: "" },
      { at: "2026-10-16T06:40:00Z", kind: "failed", repo: "hearthtale", title: "Hearthtale's data job failed", body: "" },
    ] as events.Event[];
    const d = digestOf(h, ev, new Date("2026-10-16T07:15:00Z"));
    expect(d.title).toBe("Ravenpost · Friday 16 October");
    expect(d.lines).toEqual([
      "New game data in Yonder and the Codex.",
      "Hearthtale's data job failed.",
      "22 downloads: Yonder +22.",
      "Ravenpost: 3 installs active, 1 sharing.",
      "Sharing: 40 facts from 1 player, 12 new to the database.",
      "Visitors: hearthtale 120.",
    ]);
    expect(digestOf({ days: {} }, [], new Date("2026-10-16T07:15:00Z")).lines).toEqual(["No new game data."]);
  });

  test("the morning's cron keeps the digest and starts the next one from it", async () => {
    await app.request("/api/events", json({ kind: "waiting", repo: "wow-data", title: "Players' facts wait for you" }, { authorization: "Bearer ev3nts" }));
    const res = await app.request("/api/cron/digest", { headers: { authorization: "Bearer t0ken" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lines: string[] }).lines[0]).toBe("Players' facts wait for you.");
    const again = (await (await app.request("/api/cron/digest", { headers: { authorization: "Bearer t0ken" } })).json()) as { lines: string[] };
    expect(again.lines[0]).toBe("No new game data.");
  });
});

describe("notifications", () => {
  test("a device subscribed by its owner is told, by Web Push", async () => {
    const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
    process.env.VAPID_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey("raw", vapid.publicKey)).toString("base64url");
    process.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d!;
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const sub = {
      endpoint: "https://push.example/abc",
      keys: { p256dh: Buffer.from(await crypto.subtle.exportKey("raw", ua.publicKey)).toString("base64url"), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") },
    };
    expect((await app.request("/api/push/subscriptions", json(sub))).status).toBe(401);
    expect((await app.request("/api/push/subscriptions", json(sub, owner()))).status).toBe(200);
    const sent: { url: string; headers: Headers }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: new Headers(init.headers) });
      return new Response("", { status: 201 });
    }) as typeof fetch;
    const res = await app.request("/api/events", json({ kind: "merged", repo: "yonder", title: "Yonder's game data updated", body: "x" }, { authorization: "Bearer ev3nts" }));
    expect(((await res.json()) as { sent: number }).sent).toBe(1);
    expect(sent[0].url).toBe(sub.endpoint);
    expect(sent[0].headers.get("authorization")).toStartWith("vapid t=");
    // (gone: forgotten)
    globalThis.fetch = (async () => new Response("", { status: 410 })) as unknown as typeof fetch;
    expect(((await (await app.request("/api/push/test", { method: "POST", headers: owner() })).json()) as { gone: number }).gone).toBe(1);
    globalThis.fetch = realFetch;
    expect(((await (await app.request("/api/push/test", { method: "POST", headers: owner() })).json()) as { sent: number }).sent).toBe(0);
  });
});

describe("wowhead relay", () => {
  test("a Wowhead tab hands its pages over, wow-data takes them", async () => {
    const pre = await app.request("/api/wowhead/pages", { method: "OPTIONS", headers: { origin: "https://www.wowhead.com", "access-control-request-method": "POST" } });
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://www.wowhead.com");
    const pages = { "quest/enUS/2": { title: "Sharptalon's Claw" }, "npc/enUS/3": { missing: "404" } };
    expect((await app.request("/api/wowhead/pages", json({ pages }))).status).toBe(401);
    expect((await app.request("/api/wowhead/pages", json({ pages: { "quest/xx/2": {} } }, { authorization: "Bearer wh34d" }))).status).toBe(400);
    expect((await app.request("/api/wowhead/pages", json({ pages }, { authorization: "Bearer wh34d" }))).status).toBe(200);
    const auth = { authorization: "Bearer wh34d" };
    const list = (await (await app.request("/api/wowhead/list", { headers: auth })).json()) as { names: { name: string }[] };
    expect(list.names.length).toBe(1);
    const names = list.names.map((n) => n.name);
    const read = (await (await app.request("/api/wowhead/read", json({ names }, auth))).json()) as { items: { pages: Record<string, unknown> }[] };
    expect(read.items[0].pages).toEqual(pages);
    await app.request("/api/wowhead/done", json({ names }, auth));
    expect(((await (await app.request("/api/wowhead/list", { headers: auth })).json()) as { names: unknown[] }).names.length).toBe(0);
    // (the inbox's own files stay out of its reach)
    expect((await app.request("/api/wowhead/read", json({ names: ["stats/history.json"] }, auth))).status).toBe(400);
  });
});
