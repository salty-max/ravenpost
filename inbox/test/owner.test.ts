import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { ENDPOINTS } from "../../ui/src/schema";
import { app } from "../src/app";
import { setFetch, signAs, tokenFor, ownerTokenFor, ownerCodeFor, subOf } from "../src/auth";
import { dashboard } from "../src/dashboard";
import { forgetAsked, setGitHubFetch } from "../src/github";
import { resetLimits } from "../src/ratelimit";
import * as store from "../src/store";
import * as fx from "./fixtures/dashboard";

/**
 * The owner API: the sign-in by the app's own route, the token and its kinds,
 * the six GETs (the cookie or the token), the ETag, the kill switches, and
 * that none of it says anything about one player.
 */
const OWNER = "Namzar#21586";
const now = () => Math.floor(Date.now() / 1000);
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");
const VERIFIER = "v".repeat(64);
const CHALLENGE = challengeOf(VERIFIER);
const NONCE = "n".repeat(24);
const get = (p: string, headers: Record<string, string> = {}) => app.request(p, { headers });
const withToken = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const json = async (r: Response) => (await r.json()) as any;
const token = () => ownerTokenFor(OWNER).token;
const cookie = (tag = OWNER, typ: "stats" | "owner" = "stats") => ({ cookie: `rp_stats=${signAs(typ, { tag, exp: now() + 600 })}` });
const PARTS = ["summary", "numbers", "players", "comments", "activity", "releases"] as const;

const ENV = ["STATS_BATTLETAGS", "OWNER_API_OFF", "OWNER_REVOKED_BEFORE", "INBOX_DEV", "BNET_CLIENT_ID", "BNET_CLIENT_SECRET", "INBOX_ORIGIN", "INBOX_TOKEN", "CRON_SECRET", "UNIQUE_TOKEN", "INBOX_EVENTS_TOKEN", "WOWHEAD_TOKEN", "CURSEFORGE_COOKIE", "INBOX_SIGNING_KEY", "INBOX_SECRET"];
const SECRET_ENV: Record<string, string> = {
  INBOX_TOKEN: "tok-inbox-7d41c0aa",
  CRON_SECRET: "tok-cron-52b8e1f3",
  UNIQUE_TOKEN: "tok-unique-0c9a77de",
  INBOX_EVENTS_TOKEN: "tok-events-91ae33b0",
  WOWHEAD_TOKEN: "tok-wowhead-63f2d8c5",
  CURSEFORGE_COOKIE: "cookie-cf-a83e5b19",
  BNET_CLIENT_SECRET: "bnet-secret-4410dd7e",
};

async function seed() {
  const w = (name: string, v: unknown) => store.write(name, JSON.stringify(v));
  await w("stats/history.json", fx.history);
  await w("stats/today.json", fx.today);
  await w("stats/unique.json", fx.unique);
  await w("downloads/2026-10-28.json", { readings: fx.readings.filter((r) => r[0].startsWith("2026-10-28")) });
  await w("downloads/2026-10-29.json", { readings: fx.readings.filter((r) => r[0].startsWith("2026-10-29")) });
  await w("releases/latest.json", fx.releases);
  await w("releases/github.json", fx.github);
  await w("events/recent.json", fx.events);
  await w("events/resolved.json", fx.resolved);
  await w("comments/recent.json", { threads: fx.threads });
  // (what the inbox keeps about one player: none of it may reach an answer)
  await w("stats/installs.json", { since: "2026-10-20", installs: Object.fromEntries(fx.SECRETS.installHashes.map((h) => [h, { first: "2026-10-20", last: "2026-10-28" }])) });
  await store.write(`pings/2026-10-29/${fx.SECRETS.installHashes[0]}.json`, "{}");
  await store.write("inbox/classic/2026-10-29T10:00:00.000Z-aa.json", JSON.stringify({ who: fx.SECRETS.subs[0], at: "2026-10-29T10:00:00Z", facts: [] }));
  await w(`counts/2026-10-29/${fx.SECRETS.subs[1]}.json`, { uploads: 1, facts: 4, games: {}, locales: {} });
}

beforeEach(async () => {
  process.env.INBOX_DIR = mkdtempSync(path.join(tmpdir(), "owner-"));
  process.env.STATS_BATTLETAGS = `${OWNER}, Other#1`;
  Object.assign(process.env, SECRET_ENV);
  for (const k of ["OWNER_API_OFF", "OWNER_REVOKED_BEFORE", "INBOX_DEV", "INBOX_SECRET", "INBOX_SIGNING_KEY"]) delete process.env[k];
  setSystemTime(new Date(fx.NOW));
  resetLimits();
  forgetAsked();
  setGitHubFetch(async () => new Response("", { status: 404 }));
  await seed();
});
afterEach(() => {
  rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
  for (const k of ENV) delete process.env[k];
  delete process.env.INBOX_DIR;
  setSystemTime();
  setFetch((input, init) => fetch(input, init));
  setGitHubFetch((input, init) => fetch(input, init));
});
afterAll(() => setSystemTime());

describe("signing in as the owner", () => {
  const bnet = (tag: string) => async (url: string) => {
    if (url.includes("/token")) return Response.json({ access_token: "a" });
    if (url.includes("/userinfo")) return Response.json({ id: 7, battletag: tag });
    return new Response("", { status: 404 });
  };
  const start = async (extra = "") => {
    process.env.BNET_CLIENT_ID = "id";
    process.env.INBOX_ORIGIN = "https://inbox.test";
    const res = await get(`/api/login?port=5555&nonce=${NONCE}&v=2&challenge=${CHALLENGE}&owner=1${extra}`);
    expect(res.status).toBe(302);
    return new URL(res.headers.get("location")!);
  };

  test("through Battle.net to the app's loopback with a code, never a token or a passport, then a token for the code", async () => {
    const bn = await start();
    expect(bn.origin + bn.pathname).toBe("https://oauth.battle.net/authorize");
    setFetch(bnet(OWNER));
    const back = await get(`/api/login/callback?code=bn&state=${encodeURIComponent(bn.searchParams.get("state")!)}`);
    const to = new URL(back.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe("http://127.0.0.1:5555/linked");
    expect([...to.searchParams.keys()].sort()).toEqual(["code", "nonce"]);
    expect(to.searchParams.get("nonce")).toBe(NONCE);
    const code = to.searchParams.get("code")!;
    const ex = (body: unknown) => app.request("/api/owner/exchange", { method: "POST", body: JSON.stringify(body) });
    expect((await ex({ code, verifier: "w".repeat(64) })).status).toBe(400);
    expect((await ex({ code: "nonsense", verifier: VERIFIER })).status).toBe(400);
    const ok = await ex({ code, verifier: VERIFIER });
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(Object.keys(body).sort()).toEqual(["expires", "token"]);
    expect(body.expires).toBe(now() + 30 * 86400);
    expect((await get("/api/owner/summary", withToken(body.token))).status).toBe(200);
  });

  test("a BattleTag not on the list is sent back denied, with no code", async () => {
    const bn = await start();
    setFetch(bnet("Stranger#9"));
    const back = await get(`/api/login/callback?code=bn&state=${encodeURIComponent(bn.searchParams.get("state")!)}`);
    const to = new URL(back.headers.get("location")!);
    expect(to.searchParams.get("error")).toBe("denied");
    expect(to.searchParams.has("code")).toBe(false);
  });

  test("the app's code lasts two minutes, and an owner removed from the list since gets no token", async () => {
    const code = ownerCodeFor(OWNER, CHALLENGE);
    const ex = () => app.request("/api/owner/exchange", { method: "POST", body: JSON.stringify({ code, verifier: VERIFIER }) });
    setSystemTime(new Date(fx.NOW + 121_000));
    expect((await ex()).status).toBe(400);
    setSystemTime(new Date(fx.NOW));
    process.env.STATS_BATTLETAGS = "Other#1";
    expect((await ex()).status).toBe(400);
  });

  test("owner=1 needs the v=2 challenge", async () => {
    process.env.BNET_CLIENT_ID = "id";
    expect((await get(`/api/login?port=5555&nonce=${NONCE}&owner=1`)).status).toBe(400);
    expect((await get(`/api/login?port=5555&nonce=${NONCE}&v=2&challenge=short&owner=1`)).status).toBe(400);
  });

  test("on this computer INBOX_DEV signs the dev account in with no Battle.net", async () => {
    process.env.INBOX_DEV = "1";
    const res = await get(`/api/login?port=5555&nonce=${NONCE}&v=2&challenge=${CHALLENGE}&owner=1`);
    const to = new URL(res.headers.get("location")!);
    const ex = await app.request("/api/owner/exchange", { method: "POST", body: JSON.stringify({ code: to.searchParams.get("code"), verifier: VERIFIER }) });
    expect(ex.status).toBe(200);
    expect((await get("/api/owner/summary", withToken((await json(ex)).token))).status).toBe(200);
    // (never on Vercel)
    const dev = ownerTokenFor("Tester#1234").token;
    process.env.VERCEL = "1";
    process.env.INBOX_SECRET = "s";
    try {
      expect((await get("/api/owner/summary", withToken(dev))).status).toBe(401);
    } finally {
      delete process.env.VERCEL;
      delete process.env.INBOX_SECRET;
    }
  });
});

describe("the token's kinds", () => {
  test("an owner token opens the owner API and nothing else; nothing else opens it", async () => {
    const t = token();
    const sharing = tokenFor({ sub: subOf(7), tag: OWNER });
    const stats = signAs("stats", { tag: OWNER, exp: now() + 600 });
    const code = ownerCodeFor(OWNER, CHALLENGE);
    for (const wrong of [sharing, stats, code, signAs("state", { exp: now() + 600 }), signAs("code", { sub: "x", tag: OWNER, chl: CHALLENGE, exp: now() + 60 }), "", "garbage", `${t}x`])
      expect((await get("/api/owner/summary", withToken(wrong))).status).toBe(401);
    expect((await get("/api/owner/summary")).status).toBe(401);
    // (the owner token where a sharing token, the stats cookie or a code is wanted)
    const facts = await app.request("/api/facts", { method: "POST", headers: withToken(t), body: "{}" });
    expect(facts.status).toBe(401);
    expect((await app.request("/api/token/refresh", { method: "POST", headers: withToken(t) })).status).toBe(401);
    expect((await app.request("/api/inbox/list?game=classic", { headers: withToken(t) })).status).toBe(401);
    expect((await app.request("/api/login/exchange", { method: "POST", body: JSON.stringify({ code: t, verifier: VERIFIER }) })).status).toBe(400);
    expect((await app.request("/api/login/exchange", { method: "POST", body: JSON.stringify({ code: ownerCodeFor(OWNER, CHALLENGE), verifier: VERIFIER }) })).status).toBe(400);
    expect((await get("/stats", { cookie: `rp_stats=${t}` })).status).toBe(200);
    expect(await (await get("/stats", { cookie: `rp_stats=${t}` })).text()).toContain("Sign in with Battle.net");
    expect((await app.request("/api/push/test", { method: "POST", headers: { cookie: `rp_stats=${t}` } })).status).toBe(401);
    // (a sharing token's own refresh still works)
    expect((await app.request("/api/token/refresh", { method: "POST", headers: withToken(sharing) })).status).toBe(200);
  });

  test("the dashboard's cookie opens the GETs, and nothing that is not a GET", async () => {
    for (const p of PARTS) expect((await get(`/api/owner/${p}`, cookie())).status).toBe(200);
    expect((await get("/api/owner/summary", cookie("Someone#1"))).status).toBe(401);
    // (an owner token in the cookie's place is no cookie)
    expect((await get("/api/owner/summary", cookie(OWNER, "owner"))).status).toBe(401);
    expect((await app.request("/api/owner/refresh", { method: "POST", headers: cookie() })).status).toBe(401);
    // (a bad token given is the one judged: it never falls back to a good cookie)
    expect((await get("/api/owner/summary", { ...cookie(), authorization: "Bearer nonsense" })).status).toBe(401);
  });

  test("a token for a BattleTag off the list, an expired one, one past its day: refused", async () => {
    expect((await get("/api/owner/summary", withToken(ownerTokenFor("Someone#1").token))).status).toBe(401);
    const t = token();
    setSystemTime(new Date(fx.NOW + 29 * 86_400_000));
    expect((await get("/api/owner/summary", withToken(t))).status).toBe(200);
    setSystemTime(new Date(fx.NOW + 31 * 86_400_000));
    expect((await get("/api/owner/summary", withToken(t))).status).toBe(401);
    process.env.STATS_BATTLETAGS = "Other#1";
    setSystemTime(new Date(fx.NOW));
    expect((await get("/api/owner/summary", withToken(t))).status).toBe(401);
  });

  test("refreshed for 30 more days up to a year after the first sign-in, then sign in again", async () => {
    const first = await json(await app.request("/api/owner/refresh", { method: "POST", headers: withToken(token()) }));
    expect(first.expires).toBe(now() + 30 * 86400);
    let t = token();
    for (let year = 0; year < 12; year++) {
      setSystemTime(new Date(Date.now() + 29 * 86_400_000));
      const res = await app.request("/api/owner/refresh", { method: "POST", headers: withToken(t) });
      expect(res.status).toBe(200);
      t = (await json(res)).token;
    }
    // (360 days in)
    setSystemTime(new Date(Date.now() + 29 * 86_400_000));
    expect((await app.request("/api/owner/refresh", { method: "POST", headers: withToken(t) })).status).toBe(403);
    expect((await app.request("/api/owner/refresh", { method: "POST" })).status).toBe(401);
  });

  test("OWNER_REVOKED_BEFORE refuses the tokens made before it, and leaves the cookie and the web alone", async () => {
    const old = token();
    setSystemTime(new Date(fx.NOW + 60_000));
    const fresh = token();
    process.env.OWNER_REVOKED_BEFORE = new Date(fx.NOW + 30_000).toISOString();
    expect((await get("/api/owner/summary", withToken(old))).status).toBe(401);
    expect((await get("/api/owner/summary", withToken(fresh))).status).toBe(200);
    expect((await app.request("/api/owner/refresh", { method: "POST", headers: withToken(old) })).status).toBe(401);
    expect((await get("/api/owner/summary", cookie())).status).toBe(200);
    // (epoch seconds work too)
    process.env.OWNER_REVOKED_BEFORE = String(Math.floor((fx.NOW + 90_000) / 1000));
    expect((await get("/api/owner/summary", withToken(fresh))).status).toBe(401);
    // (a value that is no time: every token refused)
    process.env.OWNER_REVOKED_BEFORE = "tomorrow-ish";
    expect((await get("/api/owner/summary", withToken(fresh))).status).toBe(401);
    expect((await get("/api/owner/summary", cookie())).status).toBe(200);
  });

  test("OWNER_API_OFF=1: all of it answers 404, whoever asks", async () => {
    process.env.OWNER_API_OFF = "1";
    for (const p of PARTS) {
      expect((await get(`/api/owner/${p}`, withToken(token()))).status).toBe(404);
      expect((await get(`/api/owner/${p}`, cookie())).status).toBe(404);
    }
    expect((await app.request("/api/owner/exchange", { method: "POST", body: JSON.stringify({ code: ownerCodeFor(OWNER, CHALLENGE), verifier: VERIFIER }) })).status).toBe(404);
    expect((await app.request("/api/owner/refresh", { method: "POST", headers: withToken(token()) })).status).toBe(404);
    // (the dashboard is not part of it)
    expect((await get("/stats", cookie())).status).toBe(200);
    delete process.env.OWNER_API_OFF;
    expect((await get("/api/owner/summary", withToken(token()))).status).toBe(200);
  });
});

describe("the six answers", () => {
  test("each is its schema's shape, strictly, and carries an ETag and no-store", async () => {
    for (const p of PARTS) {
      const res = await get(ENDPOINTS[p].path, withToken(token()));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("etag")).toMatch(/^"[\w-]{22}"$/);
      const parsed = ENDPOINTS[p].schema.safeParse(await res.json());
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    }
  });

  test("the same numbers as the page, from the same functions", async () => {
    const html = dashboard(fx.history, { ...fx.dashboardOptions });
    const page = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]);
    const n = await json(await get("/api/owner/numbers", withToken(token())));
    const p = await json(await get("/api/owner/players", withToken(token())));
    expect(n.days).toEqual(page.days);
    expect(n.downloads.daily).toEqual(page.downloads.daily);
    expect(n.downloads.totals).toEqual(page.downloads.totals);
    expect(n.downloads.stores).toEqual(page.downloads.stores);
    expect(n.unique).toEqual(page.unique);
    expect(n.rank).toEqual(page.rank);
    expect(n.periods).toEqual(page.periods);
    expect(n.marks).toEqual(page.marks);
    expect(n.hourly).toEqual(page.hourly);
    for (const k of ["installs", "installsWeek", "facts", "sharers", "newFacts", "sites"]) expect(p[k]).toEqual(page[k]);
    const s = await json(await get("/api/owner/summary", withToken(token())));
    expect(s.figures.downloads.total).toBe(Object.values(page.downloads.totals as Record<string, number>).reduce((a, b) => a + b, 0));
    expect(s.figures.visitors.today).toBe(25);
    expect(s.commentsWaiting).toBe(1);
    expect(s.standing.title).toBe("A job failed");
    expect(s.problems).toEqual({ failed: 1, waiting: 0 });
    expect(s.through).toBe("2026-10-29");
    // (the PR the job merged since is no problem: GitHub's word, kept in events/resolved.json)
    const a = await json(await get("/api/owner/activity", withToken(token())));
    expect(a.events.find((e: any) => e.kind === "waiting").settled).toEqual({ at: "2026-10-29T09:00:00Z", how: "merged" });
    expect(a.events.find((e: any) => e.repo === "yonder" && e.kind === "failed").addon).toBe("Yonder");
  });

  test("range cuts the daily series to its last days, and a bad one is refused", async () => {
    const all = await json(await get("/api/owner/numbers", withToken(token())));
    const week = await json(await get("/api/owner/numbers?range=7", withToken(token())));
    expect(week.range).toBe("7");
    expect(week.days).toEqual(all.days.slice(-7));
    expect(week.downloads.daily.Yonder).toEqual(all.downloads.daily.Yonder.slice(-7));
    expect(week.downloads.stores.curseforge).toHaveLength(7);
    expect(week.rank.Yonder).toHaveLength(7);
    expect(week.downloads.totals).toEqual(all.downloads.totals);
    expect((await json(await get("/api/owner/numbers?range=90", withToken(token())))).days).toEqual(all.days);
    expect((await get("/api/owner/numbers?range=forever", withToken(token()))).status).toBe(400);
    expect((await get("/api/owner/numbers?range=0", withToken(token()))).status).toBe(400);
  });

  test("an empty inbox answers too", async () => {
    rmSync(process.env.INBOX_DIR!, { recursive: true, force: true });
    for (const p of PARTS) {
      const res = await get(ENDPOINTS[p].path, withToken(token()));
      expect(res.status).toBe(200);
      expect(ENDPOINTS[p].schema.safeParse(await res.json()).success).toBe(true);
    }
  });

  test("the stale flag: CurseForge's people counts brought too long ago", async () => {
    const s = async () => (await json(await get("/api/owner/summary", withToken(token())))).unique;
    expect(await s()).toEqual({ at: fx.unique.at, through: "2026-10-27", stale: false });
    setSystemTime(new Date(fx.NOW + 4 * 3600_000));
    expect((await s()).stale).toBe(true);
    rmSync(path.join(process.env.INBOX_DIR!, "stats/unique.json"));
    expect(await s()).toEqual({ at: null, through: null, stale: false });
  });
});

describe("the ETag", () => {
  test("If-None-Match that still holds is a 304 with no body, a changed answer is a 200 with a new tag", async () => {
    const t = token();
    for (const p of PARTS) {
      const first = await get(ENDPOINTS[p].path, withToken(t));
      const tag = first.headers.get("etag")!;
      const again = await get(ENDPOINTS[p].path, withToken(t, { "if-none-match": tag }));
      expect(again.status).toBe(304);
      expect(await again.text()).toBe("");
      expect(again.headers.get("etag")).toBe(tag);
      expect(again.headers.get("cache-control")).toBe("private, no-store");
      expect((await get(ENDPOINTS[p].path, withToken(t, { "if-none-match": `W/${tag}` }))).status).toBe(304);
      expect((await get(ENDPOINTS[p].path, withToken(t, { "if-none-match": `"other", ${tag}` }))).status).toBe(304);
      expect((await get(ENDPOINTS[p].path, withToken(t, { "if-none-match": '"other"' }))).status).toBe(200);
    }
    // (the answer moves with the data)
    const was = (await get("/api/owner/comments", withToken(t))).headers.get("etag")!;
    await store.write("comments/recent.json", JSON.stringify({ threads: fx.threads.map((x) => ({ ...x, answered: true })) }));
    const res = await get("/api/owner/comments", withToken(t, { "if-none-match": was }));
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).not.toBe(was);
    // (a 304 is asked for with the cookie too, and is not given to a stranger)
    expect((await get("/api/owner/comments", { ...cookie("Someone#1"), "if-none-match": was })).status).toBe(401);
  });

  test("the summary's stamps are each part's own ETag", async () => {
    const t = token();
    const s = await json(await get("/api/owner/summary", withToken(t)));
    for (const p of ["numbers", "players", "comments", "activity", "releases"] as const)
      expect(s.stamps[p]).toBe((await get(ENDPOINTS[p].path, withToken(t))).headers.get("etag")!);
    // (a new comment moves the comments' stamp and not the players')
    await store.write("comments/recent.json", JSON.stringify({ threads: [] }));
    const s2 = await json(await get("/api/owner/summary", withToken(t)));
    expect(s2.stamps.comments).not.toBe(s.stamps.comments);
    expect(s2.stamps.players).toBe(s.stamps.players);
    expect(s2.stamps.releases).toBe(s.stamps.releases);
  });
});

describe("the owner API reads, it never writes, and says nothing of one player", () => {
  test("the routes under /api/owner/: six GETs and the two POSTs of the sign-in, nothing else", () => {
    const routes = [...new Set(app.routes.filter((r) => r.path.startsWith("/api/owner") && r.method !== "ALL").map((r) => `${r.method} ${r.path}`))].sort();
    expect(routes).toEqual([
      "GET /api/owner/activity",
      "GET /api/owner/comments",
      "GET /api/owner/numbers",
      "GET /api/owner/players",
      "GET /api/owner/releases",
      "GET /api/owner/summary",
      "POST /api/owner/exchange",
      "POST /api/owner/refresh",
    ]);
    // (no route lists a token, a secret or a file)
    expect(routes.some((r) => /secret|token|key|list|read|inbox|installs/i.test(r.replace("/api/owner/", "")))).toBe(false);
  });

  test("a HEAD is judged like the GET it runs", async () => {
    for (const p of PARTS) {
      expect((await app.request(`/api/owner/${p}`, { method: "HEAD" })).status).toBe(401);
      expect((await app.request(`/api/owner/${p}`, { method: "HEAD", headers: withToken("nonsense") })).status).toBe(401);
      expect((await app.request(`/api/owner/${p}`, { method: "HEAD", headers: withToken(token()) })).status).toBe(200);
    }
  });

  test("a write is no route", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      for (const p of PARTS) expect((await app.request(`/api/owner/${p}`, { method, headers: withToken(token()), body: "{}" })).status).toBe(404);
  });

  test("a leaked token's answers carry no hash, sub, name of a file or secret of the inbox", async () => {
    const t = token();
    const bodies: string[] = [];
    for (const p of PARTS) bodies.push(await (await get(ENDPOINTS[p].path, withToken(t))).text());
    for (const r of ["7", "30", "90"]) bodies.push(await (await get(`/api/owner/numbers?range=${r}`, withToken(t))).text());
    expect(bodies.every((b) => b.length > 100)).toBe(true);
    const everything = bodies.join("\n");
    const known = [
      ...fx.SECRETS.installHashes,
      ...fx.SECRETS.subs,
      ...Object.values(SECRET_ENV),
      t,
      "installs.json",
      "inbox/classic",
      "pings/",
      "counts/",
      "who",
      subOf(7),
      subOf("dev"),
    ];
    for (const secret of known) expect(everything, secret).not.toContain(secret);
    // (by shape: no key that names a player or an install, and no value that is a hash)
    const walk = (v: unknown, at: string) => {
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          expect(k, at).not.toMatch(/^(sub|who|hash|hashes|id|ids|install|installId|bnetId|passport|token|secret)$/i);
          walk(x, `${at}.${k}`);
        }
      } else if (typeof v === "string") expect(v, at).not.toMatch(/^[0-9a-f]{16,}$/i);
    };
    for (const b of bodies) walk(JSON.parse(b), "$");
  });

  test("every thread and release leaves its CurseForge id behind", async () => {
    const c = await json(await get("/api/owner/comments", withToken(token())));
    expect(Object.keys(c.threads[0]).sort()).toEqual(["addon", "answered", "at", "author", "last", "replies", "repo", "text", "url"]);
    const r = await json(await get("/api/owner/releases", withToken(token())));
    expect(Object.keys(r.addons.find((a: any) => a.name === "Yonder").curseforge).sort()).toEqual(["at", "downloads", "type", "version"]);
  });

  test("a rate limit per owner: 120 reads a minute", async () => {
    const t = token();
    for (let i = 0; i < 120; i++) expect((await get("/api/owner/comments", withToken(t))).status).toBe(200);
    expect((await get("/api/owner/comments", withToken(t))).status).toBe(429);
    // (the other owner on the list has their own)
    expect((await get("/api/owner/comments", withToken(ownerTokenFor("Other#1").token))).status).toBe(200);
  });

  test("the exchange and refresh are paced too", async () => {
    const ex = () => app.request("/api/owner/exchange", { method: "POST", body: JSON.stringify({ code: "x", verifier: "y" }) });
    for (let i = 0; i < 10; i++) expect((await ex()).status).toBe(400);
    expect((await ex()).status).toBe(429);
    const t = token();
    for (let i = 0; i < 5; i++) expect((await app.request("/api/owner/refresh", { method: "POST", headers: withToken(t) })).status).toBe(200);
    expect((await app.request("/api/owner/refresh", { method: "POST", headers: withToken(t) })).status).toBe(429);
  });
});
