import { afterEach, describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { createHash } from "node:crypto";
import { sharer, signAs, signUntyped as sign, subOf, tokenFor, verify } from "../src/auth";
import { resetLimits } from "../src/ratelimit";

const now = () => Math.floor(Date.now() / 1000);
const verifier = "a-secret-ravenpost-keeps-to-itself-0123456789";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const claims = (t: string) => JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString());

afterEach(() => {
  delete process.env.STATS_BATTLETAGS;
  delete process.env.INBOX_BLOCKED;
  delete process.env.INBOX_DEV;
  resetLimits();
});

describe("what each signed thing is for", () => {
  test("a sharing token says so and ends after 90 days", () => {
    const c = claims(tokenFor({ sub: subOf(1), tag: "Max#1234" }));
    expect(c.typ).toBe("share");
    expect(c.exp - c.iat).toBe(90 * 86400);
  });

  test("one kind is never taken for another", () => {
    const share = tokenFor({ sub: subOf(1), tag: "Max#1234" });
    expect(verify(share, "stats")).toBeNull();
    expect(verify(share, "state")).toBeNull();
    expect(verify(signAs("state", { port: 1, nonce: "n", exp: now() + 60 }), "share")).toBeNull();
    expect(sharer(`Bearer ${signAs("code", { sub: subOf(1), tag: "Max#1234", exp: now() + 60 })}`)).toBeNull();
    expect(sharer(`Bearer ${signAs("stats", { sub: subOf(1), tag: "Max#1234", exp: now() + 60 })}`)).toBeNull();
  });

  test("the owner's own sharing token is no way into the dashboard", async () => {
    process.env.STATS_BATTLETAGS = "Namzar#21586";
    const share = tokenFor({ sub: subOf(4242), tag: "Namzar#21586" });
    expect(await (await app.request("/stats", { headers: { cookie: `rp_stats=${share}` } })).text()).toContain("Sign in with Battle.net");
    // (nor an old token of the same shape as the old cookie)
    const legacy = sign({ sub: subOf(4242), tag: "Namzar#21586", iat: now() });
    expect(await (await app.request("/stats", { headers: { cookie: `rp_stats=${legacy}` } })).text()).toContain("Sign in with Battle.net");
    const cookie = signAs("stats", { tag: "Namzar#21586", exp: now() + 60 });
    expect(await (await app.request("/stats", { headers: { cookie: `rp_stats=${cookie}` } })).text()).not.toContain("Sign in with Battle.net");
  });

  test("a token from before (no kind, no end): a sharing token for 90 days from when it was made, nothing else", () => {
    const recent = sign({ sub: subOf(1), tag: "Max#1234", iat: now() - 10 * 86400 });
    expect(sharer(`Bearer ${recent}`)).toMatchObject({ sub: subOf(1) });
    expect(verify(recent, "state")).toBeNull();
    expect(sharer(`Bearer ${sign({ sub: subOf(1), tag: "Max#1234", iat: now() - 91 * 86400 })}`)).toBeNull();
    expect(sharer(`Bearer ${sign({ sub: subOf(1), tag: "Max#1234" })}`)).toBeNull();
    // (only that shape: no account, or an end of its own, is no old sharing token)
    expect(sharer(`Bearer ${sign({ tag: "Max#1234", iat: now() })}`)).toBeNull();
    expect(sharer(`Bearer ${sign({ sub: subOf(1), tag: "Max#1234", iat: now(), exp: now() + 60 })}`)).toBeNull();
  });
});

describe("the hand-back and the refresh", () => {
  test("a Ravenpost that asks for it gets a short code in the address, traded for its token over https", async () => {
    process.env.INBOX_DEV = "1";
    expect((await app.request("/api/login?port=51234&nonce=abcdefghijklmnop&v=2")).status).toBe(400);
    const res = await app.request(`/api/login?port=51234&nonce=abcdefghijklmnop&v=2&challenge=${challenge}`);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("http://127.0.0.1:51234");
    expect(to.searchParams.get("token")).toBeNull();
    const code = to.searchParams.get("code")!;
    expect(claims(code).exp - now()).toBeLessThanOrEqual(120);
    expect(JSON.stringify(claims(code))).not.toContain(".");
    const trade = (body: object) => app.request("/api/login/exchange", { method: "POST", body: JSON.stringify(body) });
    // (read from the history, without the verifier only that Ravenpost holds: nothing)
    expect((await trade({ code })).status).toBe(400);
    expect((await trade({ code, verifier: "someone-else-s-guess-0123456789-0123456789" })).status).toBe(400);
    const { token } = (await (await trade({ code, verifier })).json()) as { token: string };
    expect(sharer(`Bearer ${token}`)?.tag).toBe("Tester#1234");
    // (a code past its two minutes, or something else signed, buys nothing)
    const old = signAs("code", { sub: subOf(1), tag: "x", chl: challenge, exp: now() - 1 });
    expect((await trade({ code: old, verifier })).status).toBe(400);
    expect((await trade({ code: token, verifier })).status).toBe(400);
  });

  test("an older Ravenpost still gets its token the way it knows", async () => {
    process.env.INBOX_DEV = "1";
    const to = new URL((await app.request("/api/login?port=51234&nonce=abcdefghijklmnop")).headers.get("location")!);
    expect(sharer(`Bearer ${to.searchParams.get("token")}`)?.tag).toBe("Tester#1234");
  });

  test("a token traded for a fresh one while it holds, never once blocked", async () => {
    const t = sign({ sub: subOf(1), tag: "Max#1234", iat: now() - 40 * 86400 });
    const res = await app.request("/api/token/refresh", { method: "POST", headers: { authorization: `Bearer ${t}` } });
    const { token } = (await res.json()) as { token: string };
    expect(claims(token)).toMatchObject({ typ: "share", sub: subOf(1), tag: "Max#1234", auth: now() - 40 * 86400 });
    expect(claims(token).iat).toBeGreaterThan(now() - 5);
    // (the first sign-in a year and more ago: no more refreshing, the token itself still good to its end)
    const aged = signAs("share", { sub: subOf(2), tag: "Old#1", auth: now() - 366 * 86400, iat: now() - 10 * 86400, exp: now() + 80 * 86400 });
    expect(sharer(`Bearer ${aged}`)).not.toBeNull();
    expect((await app.request("/api/token/refresh", { method: "POST", headers: { authorization: `Bearer ${aged}` } })).status).toBe(403);
    const legacyAged = sign({ sub: subOf(3), tag: "Old#2", iat: now() - 89 * 86400 });
    expect((await app.request("/api/token/refresh", { method: "POST", headers: { authorization: `Bearer ${legacyAged}` } })).status).toBe(200);
    expect((await app.request("/api/token/refresh", { method: "POST" })).status).toBe(401);
    process.env.INBOX_BLOCKED = subOf(1);
    expect((await app.request("/api/token/refresh", { method: "POST", headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});
