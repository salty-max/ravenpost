import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { app } from "../src/app";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { setFetch, sharer, signAs, subOf, tokenFor, verify } from "../src/auth";
import { DEV_PUBLIC_KEY } from "../src/devkey";
import { flatten } from "../src/facts";
import type { Item } from "../src/inbox";

describe("facts", () => {
  test("an addon's collect table, flattened into checked facts", () => {
    const facts = flatten({
      game: "forever",
      facts: {
        enUS: {
          quest: { "92551": { title: "Stolen Supplies", details: "Hey $N, the supplies.", giver: "npc:252172", map: 2442, x: 46.1, y: 25, b: "70374" } },
          npc: { "252172": { world: true, name: "Danarii Bellowveil", level: [10, 10], rank: "normal", type: "Humanoid", reaction: 5, map: 2442 } },
          say: { "448": { "$N! Fresh meat!": "yell" } },
          gossip: { "448": { "Grr.": true } },
          loot: { "npc:299": { looted: 3, items: { "750": 2 } } },
        },
      },
    });
    const has = (kind: string, entity: string, field: string, value: string) =>
      facts!.some((f) => f.kind === kind && f.entity === entity && f.field === field && f.value === value);
    expect(has("quest", "92551", "details", "Hey $N, the supplies.")).toBe(true);
    expect(has("quest", "92551", "giver", "npc:252172")).toBe(true);
    expect(has("quest", "92551", "where", "[2442,46.1,25]")).toBe(true);
    expect(facts!.find((f) => f.field === "details")!.build).toBe("70374");
    expect(has("npc", "252172", "level", "[10,10]")).toBe(true);
    expect(has("npc", "252172", "reaction", "5")).toBe(true);
    expect(has("say", "448", "yell", "$N! Fresh meat!")).toBe(true);
    expect(has("gossip", "448", "text", "Grr.")).toBe(true);
    expect(has("loot", "npc:299", "item", "750")).toBe(true);
  });

  test("the collector's type/family ids survive, unchecked legacy NPCs and invalid ids do not", () => {
    const facts = flatten({ game: "forever", facts: { deDE: { npc: {
      "1860": { name: "Graz'nar", level: [10, 10], map: 1426, x: 47.2, y: 51.9, b: "70374" },
      "252172": { world: true, name: "Danarii", typeId: 7, familyId: 1, b: "70374" },
      "299": { world: true, typeId: "1", familyId: -1 },
      "300": { world: "true", name: "Not attested" },
      "301": { world: false, name: "Player controlled" },
      "302": { world: true, typeId: 1.5, familyId: 100001 },
    } } } });
    expect(facts?.filter((f) => f.entity === "252172").map((f) => [f.field, f.value, f.build])).toEqual([
      ["name", "Danarii", "70374"], ["typeId", "7", "70374"], ["familyId", "1", "70374"],
    ]);
    expect(facts?.some((f) => f.entity !== "252172")).toBe(false);
  });

  test("anything else is left out", () => {
    expect(flatten(null)).toBeNull();
    expect(flatten({ game: "retail", facts: {} })).toBeNull();
    const facts = flatten({
      game: "classic",
      facts: {
        xxXX: { quest: { "1": { title: "lost" } } },
        enUS: {
          quest: { abc: { title: "no id" }, "2": { title: "x".repeat(5000), giver: "player:1" } },
          npc: { "3": { level: [5, 2], rank: "r".repeat(100), reaction: 99 } },
          say: { "4": { "a line": "shout" } },
          loot: { "item:5": { items: { "6": 1 } }, "npc:7": { items: { six: 1 } } },
        },
      },
    });
    expect(facts).toEqual([]);
  });

  test("a token: signed, checked, refused once tampered with or blocked", () => {
    const t = tokenFor({ sub: subOf(42), tag: "Max#1234" });
    expect(sharer(`Bearer ${t}`)).toMatchObject({ sub: subOf(42), tag: "Max#1234" });
    expect(subOf(42)).not.toContain("42");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "someone", tag: "x" })).toString("base64url");
    expect(sharer(`Bearer ${forged}.${sig}`)).toBeNull();
    expect(sharer(`Bearer ${body}`)).toBeNull();
    expect(verify(signAs("share", { exp: Math.floor(Date.now() / 1000) - 1 }), "share")).toBeNull();
    process.env.INBOX_BLOCKED = subOf(42);
    try {
      expect(sharer(`Bearer ${t}`)).toBeNull();
    } finally {
      delete process.env.INBOX_BLOCKED;
    }
  });

  test("signing in: from Ravenpost's window only, then back to it", async () => {
    expect((await app.request("/api/login?port=80&nonce=x")).status).toBe(400);
    process.env.INBOX_DEV = "1";
    try {
      const res = await app.request("/api/login?port=51234&nonce=abcdefghijklmnop");
      const to = new URL(res.headers.get("location")!);
      expect(to.origin).toBe("http://127.0.0.1:51234");
      expect(to.searchParams.get("nonce")).toBe("abcdefghijklmnop");
      expect(sharer(`Bearer ${to.searchParams.get("token")}`)?.tag).toBe("Tester#1234");
    } finally {
      delete process.env.INBOX_DEV;
    }
    expect((await app.request("/api/login/callback?state=forged&code=x")).status).toBe(400);
    const state = signAs("state", { port: 51234, nonce: "abcdefghijklmnop", exp: Math.floor(Date.now() / 1000) + 60 });
    const denied = await app.request(`/api/login/callback?state=${state}&error=access_denied`);
    expect(denied.headers.get("location")).toBe("http://127.0.0.1:51234/linked?error=denied&nonce=abcdefghijklmnop");
  });

  test("signing in with Battle.net: a sharing token and a passport for the sites, the characters of every region", async () => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.BNET_CLIENT_SECRET = "secret";
    setFetch(async (url) => {
      if (url.endsWith("/token")) return Response.json({ access_token: "user-token" });
      if (url.endsWith("/userinfo")) return Response.json({ id: 4242, battletag: "Namzar#21586" });
      if (url.startsWith("https://eu.api.blizzard.com")) return Response.json({ wow_accounts: [{ characters: [{ id: 11, name: "Ghurdil", realm: { slug: "soulseeker" } }, { id: 12 }] }] });
      if (url.startsWith("https://us.api.blizzard.com")) return Response.json({ wow_accounts: [{ characters: [{ id: 99 }] }] });
      return new Response("", { status: 404 });
    });
    try {
      const state = signAs("state", { port: 51234, nonce: "abcdefghijklmnop", exp: Math.floor(Date.now() / 1000) + 60 });
      const res = await app.request(`/api/login/callback?state=${state}&code=c0de`);
      const to = new URL(res.headers.get("location")!);
      expect(to.origin).toBe("http://127.0.0.1:51234");
      expect(sharer(`Bearer ${to.searchParams.get("token")}`)).toMatchObject({ sub: subOf(4242), tag: "Namzar#21586" });
      const [body, sig] = to.searchParams.get("passport")!.split(".");
      expect(edVerify(null, Buffer.from(body), createPublicKey(DEV_PUBLIC_KEY), Buffer.from(sig, "base64url"))).toBe(true);
      const p = JSON.parse(Buffer.from(body, "base64url").toString());
      expect(p).toMatchObject({ aud: "sites", bnetId: 4242, battletag: "Namzar#21586" });
      expect(p.owned).toEqual([
        { region: "us", ids: [99], characters: [] },
        { region: "eu", ids: [11, 12], characters: [[11, "soulseeker", "Ghurdil"]] },
      ]);
      expect(p.exp - p.iat).toBe(600);
    } finally {
      setFetch((input, init) => fetch(input, init));
      delete process.env.BNET_CLIENT_ID;
      delete process.env.BNET_CLIENT_SECRET;
    }
  });

  test("an upload: signed in, into the inbox, and out again for wow-data", async () => {
    process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "inbox-"));
    process.env.INBOX_TOKEN = "t0ken";
    try {
      const body = { game: "forever", facts: { deDE: { quest: { "92551": { title: "Gestohlene Vorräte", b: "70374" } } } } };
      const post = (auth?: string) =>
        app.request("/api/facts", { method: "POST", headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
      expect((await post()).status).toBe(401);
      expect((await post("Bearer nope")).status).toBe(401);
      const t = tokenFor({ sub: subOf(7), tag: "Max#1234" });
      expect(await (await post(`Bearer ${t}`)).json()).toEqual({ facts: 1 });
      expect((await app.request("/api/facts", { method: "POST", headers: { authorization: `Bearer ${t}` }, body: '{"game":"retail"}' })).status).toBe(400);

      const job = (p: string, init: RequestInit = {}, token = "t0ken") =>
        app.request(p, { ...init, headers: { authorization: `Bearer ${token}` } });
      expect((await job("/api/inbox/list?game=forever", {}, "nope")).status).toBe(401);
      const listed = (await (await job("/api/inbox/list?game=forever")).json()) as { names: { name: string }[]; cursor: null };
      expect(listed.names.length).toBe(1);
      expect(listed.cursor).toBeNull();
      const names = listed.names.map((n) => n.name);
      const { items } = (await (await job("/api/inbox/read", { method: "POST", body: JSON.stringify({ names }) })).json()) as { items: Item[] };
      expect(items[0].who).toBe(subOf(7));
      expect(items[0].facts).toEqual([["deDE", "quest", "92551", "title", "Gestohlene Vorräte", "70374"]]);
      expect(await (await job("/api/inbox/done", { method: "POST", body: JSON.stringify({ names: [...names, "../../etc/passwd"] }) })).json()).toEqual({ removed: 1 });
      expect(((await (await job("/api/inbox/list?game=forever")).json()) as { names: [] }).names).toEqual([]);
    } finally {
      rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
      delete process.env.INBOX_DIR;
      delete process.env.INBOX_TOKEN;
    }
  });
});
