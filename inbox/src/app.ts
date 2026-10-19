import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { recentThreads, watch } from "./comments";
import * as curseforge from "./curseforge";
import { dashboard, signinPage } from "./dashboard";
import { digestOf } from "./digest";
import * as events from "./events";
import * as github from "./github";
import * as push from "./push";
import * as store from "./store";
import { collect, countToday, countUpload, history, ping, readPing, readUnique, record, recordUnique, today, uniquePeriods, type Day } from "./stats";
import { account, authorizeUrl, sharer, sign, subOf, tokenFor, verify } from "./auth";
import { flatten } from "./facts";
import { passportFor } from "./passport";
import { drop, names, read, remove } from "./inbox";

// Ravenpost's inbox: players sign in with Battle.net from Ravenpost once (a
// sharing token, and a passport the sites take: src/passport.ts), the facts
// they share come in, wow-data's daily job takes them out.
export const app = new Hono();

app.onError((err, c) => {
  console.error(JSON.stringify({ path: c.req.path, err: String(err) }));
  return c.json({ error: "internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" }));

// ── signing in, from Ravenpost ───────────────────────────────────────────────
const isPort = (p: string | undefined) => !!p && /^\d{4,5}$/.test(p) && Number(p) >= 1024 && Number(p) <= 65535;
const isNonce = (n: string | undefined) => !!n && /^[A-Za-z0-9]{16,64}$/.test(n);
const back = (port: string | number, q: Record<string, string>) => `http://127.0.0.1:${port}/linked?${new URLSearchParams(q)}`;
const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#16130f;color:#e8dcc2;display:grid;place-items:center;height:90vh"><div><h1 style="font-size:20px;color:#d4a843">${title}</h1><p>${text}</p></div>`;

app.get("/api/login", (c) => {
  // (the dashboard's own sign-in, in the browser: back to /stats)
  if (c.req.query("web") === "1") {
    if (!process.env.BNET_CLIENT_ID) return c.html(page("Ravenpost", "Signing in with Battle.net isn't open yet."), 503);
    return c.redirect(authorizeUrl(sign({ web: true, exp: Math.floor(Date.now() / 1000) + 600 })));
  }
  const port = c.req.query("port");
  const nonce = c.req.query("nonce");
  if (!isPort(port) || !isNonce(nonce)) return c.html(page("Ravenpost", "This page opens from Ravenpost's window."), 400);
  const state = sign({ port: Number(port), nonce, exp: Math.floor(Date.now() / 1000) + 600 });
  // (on this computer only, INBOX_DEV=1: a test account, no Battle.net)
  if (process.env.INBOX_DEV === "1" && !process.env.VERCEL)
    return c.redirect(
      back(port!, {
        token: tokenFor({ sub: subOf("dev"), tag: "Tester#1234" }),
        passport: passportFor({ bnetId: 0, battletag: "Tester#1234", owned: [] }), // (Hearthtale's local test account)
        nonce: nonce!,
      }),
    );
  if (!process.env.BNET_CLIENT_ID || !process.env.BNET_CLIENT_SECRET)
    return c.html(page("Ravenpost", "Signing in with Battle.net isn't open yet. Try again in a little while."), 503);
  return c.redirect(authorizeUrl(state));
});

app.get("/api/login/callback", async (c) => {
  const s = verify<{ port: number; nonce: string; web?: boolean }>(c.req.query("state") ?? "");
  if (!s) return c.html(page("Ravenpost", "This sign-in has expired. Click Sign in with Battle.net in Ravenpost again."), 400);
  if (s.web) {
    const who = c.req.query("code") ? await account(c.req.query("code")!).catch(() => null) : null;
    if (!who || !statsAllowed(who.battletag)) return c.html(page("Ravenpost", "This page is its owner's."), 403);
    signIn(c, who.battletag);
    return c.redirect("/stats");
  }
  const code = c.req.query("code");
  if (!code) return c.redirect(back(s.port, { error: "denied", nonce: s.nonce }));
  const who = await account(code).catch(() => null);
  if (!who) return c.redirect(back(s.port, { error: "failed", nonce: s.nonce }));
  // (the sharing token, and the passport that links the sites in the same go)
  return c.redirect(
    back(s.port, {
      token: tokenFor({ sub: subOf(who.id), tag: who.battletag }),
      passport: passportFor({ bnetId: who.id, battletag: who.battletag, owned: who.owned }),
      nonce: s.nonce,
    }),
  );
});

// ── an addon's collect table, from Ravenpost ─────────────────────────────────
app.post(
  "/api/facts",
  bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: "too large" }, 413) }),
  async (c) => {
    const who = sharer(c.req.header("authorization"));
    if (!who) return c.json({ error: "sign in with Battle.net" }, 401);
    const body = await c.req.json().catch(() => null);
    const facts = flatten(body);
    if (!facts) return c.json({ error: "not a collect table" }, 400);
    if (facts.length) {
      const game = (body as { game: string }).game;
      await drop(game, {
        who: who.sub,
        at: new Date().toISOString(),
        facts: facts.map((f) => [f.locale, f.kind, f.entity, f.field, f.value, f.build]),
      });
      const locales: Record<string, number> = {};
      for (const f of facts) locales[f.locale] = (locales[f.locale] ?? 0) + 1;
      await countUpload(who.sub, game, locales);
    }
    return c.json({ facts: facts.length });
  },
);

// ── for wow-data's daily job (bin/players.ts), behind its token ───────────────
app.use("/api/inbox/*", async (c, next) => {
  const token = process.env.INBOX_TOKEN;
  if (!token || (c.req.header("authorization") ?? "") !== `Bearer ${token}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

// A game's uploads waiting, names and sizes, a page at a time.
app.get("/api/inbox/list", async (c) => {
  const game = c.req.query("game") ?? "";
  if (game !== "classic" && game !== "forever") return c.json({ error: "no such game" }, 400);
  return c.json(await names(game, c.req.query("cursor") || undefined));
});

// Their contents (a few megabytes at a time: Vercel answers 4.5 MB at most).
app.post("/api/inbox/read", async (c) => {
  const { names: wanted } = (await c.req.json().catch(() => ({}))) as { names?: unknown };
  if (!Array.isArray(wanted) || wanted.length > 200 || !wanted.every((n) => typeof n === "string")) return c.json({ error: "names: a list" }, 400);
  return c.json({ items: await read(wanted) });
});

// Merged: out of the inbox.
app.post("/api/inbox/done", async (c) => {
  const { names: done } = (await c.req.json().catch(() => ({}))) as { names?: unknown };
  if (!Array.isArray(done) || !done.every((n) => typeof n === "string")) return c.json({ error: "names: a list" }, 400);
  return c.json({ removed: await remove(done) });
});

// Each day's numbers from wow-data's merge (bin/players.ts), or days brought by hand.
app.post("/api/inbox/stats", async (c) => {
  const { days } = (await c.req.json().catch(() => ({}))) as { days?: Record<string, Day> };
  if (!days || typeof days !== "object" || Object.keys(days).some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))
    return c.json({ error: "days: { YYYY-MM-DD: numbers }" }, 400);
  const h = await record(days);
  return c.json({ days: Object.keys(h.days).length });
});

// Each addon's downloads and unique downloaders, CurseForge's own statistics,
// brought from the owner's computer (bin/curseforge-unique.ts: they sit behind
// the owner's CurseForge session, which never leaves that computer).
app.post("/api/inbox/unique", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "too large" }, 413) }), async (c) => {
  const u = readUnique(await c.req.json().catch(() => null));
  if (!u) return c.json({ error: "days: { YYYY-MM-DD: { addon: { downloads, unique } } }, periods: { 7|30|90: … }" }, 400);
  await recordUnique(u);
  return c.json({ days: Object.keys(u.days).length, through: u.through });
});

// ── Ravenpost's daily ping (anonymous: a hash of its random install id) ──────
app.post("/api/ping", bodyLimit({ maxSize: 4096 }), async (c) => {
  const p = readPing(await c.req.json().catch(() => null));
  if (!p) return c.json({ error: "not a ping" }, 400);
  await ping(p);
  return c.json({ ok: true });
});

// ── the daily job (Vercel Cron, CRON_SECRET; or by hand with INBOX_TOKEN) ─────
app.get("/api/cron/stats", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const ok = [process.env.CRON_SECRET, process.env.INBOX_TOKEN].some((t) => t && auth === `Bearer ${t}`);
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  const h = await collect();
  return c.json({ days: Object.keys(h.days).length, updated: h.updated });
});

// ── the dashboard, for its owner (STATS_BATTLETAGS, signed in with Battle.net) ─
const STATS_COOKIE = "rp_stats";
const COOKIE_DAYS = 90;
function statsAllowed(tag: string): boolean {
  return (process.env.STATS_BATTLETAGS ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .includes(tag.toLowerCase());
}
function signIn(c: Context, tag: string) {
  setCookie(c, STATS_COOKIE, sign({ tag, exp: Math.floor(Date.now() / 1000) + COOKIE_DAYS * 86400 }), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: COOKIE_DAYS * 86400,
  });
}
/** The owner signed in, or null; their sign-in renewed once a week while they come (the app on a phone stays signed in). */
function owner(c: Context): string | null {
  if (process.env.INBOX_DEV === "1" && !process.env.VERCEL) return "Tester#1234";
  const viewer = verify<{ tag: string; exp: number }>(getCookie(c, STATS_COOKIE) ?? "");
  if (!viewer || !statsAllowed(viewer.tag)) return null;
  if (viewer.exp - Date.now() / 1000 < (COOKIE_DAYS - 7) * 86400) signIn(c, viewer.tag);
  return viewer.tag;
}

app.get("/stats", async (c) => {
  const tag = owner(c);
  c.header("Cache-Control", "private, no-store");
  if (!tag) return c.html(signinPage());
  const day = new Date().toISOString().slice(0, 10);
  const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  // (the problems GitHub has seen settled since, asked as the page is made: a few seconds at most)
  const settled = events.recent().then(async (ev) => [ev, await github.settle(ev).catch(() => ({}))] as const);
  const [h, [ev, resolved], devices, r0, r1, releases, threads, now, unique] = await Promise.all([
    history(),
    settled,
    push.devices(),
    curseforge.readings(yday),
    curseforge.readings(day),
    curseforge.latest(),
    recentThreads(),
    today(),
    uniquePeriods(),
  ]);
  return c.html(
    dashboard(h, { viewer: tag, events: ev, pushKey: push.vapid()?.publicKey ?? null, devices, readings: [...r0, ...r1], releases, threads, resolved, today: now, unique }),
  );
});
app.get("/", (c) => c.redirect("/stats"));

// ── notifications, for the owner's devices ───────────────────────────────────
app.get("/api/push/key", (c) => {
  const keys = push.vapid();
  return keys ? c.json({ key: keys.publicKey }) : c.json({ error: "no notifications here" }, 404);
});
app.post("/api/push/subscriptions", async (c) => {
  const tag = owner(c);
  if (!tag) return c.json({ error: "sign in" }, 401);
  const sub = push.readSub(await c.req.json().catch(() => null));
  if (!sub) return c.json({ error: "not a push subscription" }, 400);
  await push.subscribe(sub, tag);
  return c.json({ ok: true });
});
app.delete("/api/push/subscriptions", async (c) => {
  if (!owner(c)) return c.json({ error: "sign in" }, 401);
  const { endpoint } = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof endpoint !== "string") return c.json({ error: "endpoint" }, 400);
  await push.unsubscribe(endpoint);
  return c.json({ ok: true });
});
app.post("/api/push/test", async (c) => {
  if (!owner(c)) return c.json({ error: "sign in" }, 401);
  return c.json(await push.notify({ title: "Ravenpost", body: "Notifications work on this device.", url: "/stats", tag: "test" }, { ttl: 600, urgency: "high" }));
});

// ── what happened, from the GitHub workflows (INBOX_EVENTS_TOKEN) ────────────
const bearer = (c: Context, token: string | undefined) => {
  const got = Buffer.from(c.req.header("authorization") ?? "");
  const want = Buffer.from(`Bearer ${token}`);
  return !!token && got.length === want.length && timingSafeEqual(got, want);
};
app.post("/api/events", bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
  if (!bearer(c, process.env.INBOX_EVENTS_TOKEN)) return c.json({ error: "unauthorized" }, 401);
  const e = events.readEvent(await c.req.json().catch(() => null));
  if (!e || e.kind === "digest") return c.json({ error: "not an event" }, 400);
  await events.add(e);
  const told = await push.notify({ title: e.title, body: e.body, url: "/stats#activity", tag: `${e.kind}-${e.repo ?? "inbox"}` });
  return c.json({ ok: true, ...told });
});

// ── the morning's digest (Vercel Cron, CRON_SECRET; or by hand with INBOX_TOKEN) ─
app.get("/api/cron/digest", async (c) => {
  const ok = [process.env.CRON_SECRET, process.env.INBOX_TOKEN].some((t) => bearer(c, t));
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  const all = await events.recent();
  const last = all.find((e) => e.kind === "digest")?.at ?? new Date(Date.now() - 86_400_000).toISOString();
  const d = digestOf(await history(), await events.since(last));
  await events.add({ at: new Date().toISOString(), kind: "digest", title: d.title, body: d.body });
  const told = await push.notify({ title: d.title, body: d.body, url: "/stats#activity", tag: "digest" });
  return c.json({ ...d, ...told });
});

// ── every 10 minutes (Vercel Cron): CurseForge's comments, its releases live,
// each addon's downloads (Wago's beside, GitHub's hourly), today's installs
// and facts so far, the problems GitHub has seen settled ──────────────────────
app.get("/api/cron/curseforge", async (c) => {
  const ok = [process.env.CRON_SECRET, process.env.INBOX_TOKEN].some((t) => bearer(c, t));
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  const comments = await watch();
  const releases = await curseforge.look();
  const [t, resolved] = await Promise.all([countToday(), events.recent().then((ev) => github.settle(ev, { wait: 20_000 }))]);
  return c.json({ comments, releases, today: t, resolved: Object.keys(resolved).length });
});

// ── Wowhead's pages, from a Wowhead tab (wow-data's bin/wowhead-tab.js) ──────
// The tab can't reach this computer: it hands its pages here, wow-data takes
// them (bin/wowhead-pages.ts pull). WOWHEAD_TOKEN, theirs alone: it lives in
// a Wowhead page, so it reaches nothing but these files.
const PAGE_KEY = /^(quest|npc|object|itembook|objbook)\/(enUS|deDE|frFR|esES|esMX)\/\d{1,9}$/;
app.use("/api/wowhead/*", cors({ origin: "https://www.wowhead.com", allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST"] }));
app.use("/api/wowhead/*", async (c, next) => {
  if (c.req.method !== "OPTIONS" && !bearer(c, process.env.WOWHEAD_TOKEN)) return c.json({ error: "unauthorized" }, 401);
  await next();
});
app.post("/api/wowhead/pages", bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: "too large" }, 413) }), async (c) => {
  const { pages } = (await c.req.json().catch(() => ({}))) as { pages?: Record<string, unknown> };
  if (!pages || typeof pages !== "object" || Array.isArray(pages)) return c.json({ error: "pages: { key: page }" }, 400);
  const keys = Object.keys(pages);
  if (!keys.length || keys.length > 500 || !keys.every((k) => PAGE_KEY.test(k) && pages[k] && typeof pages[k] === "object"))
    return c.json({ error: "keys: kind/locale/id, pages: objects" }, 400);
  await store.write(`wowhead/${new Date().toISOString()}-${randomBytes(4).toString("hex")}.json`, JSON.stringify(pages));
  return c.json({ saved: keys.length });
});
app.get("/api/wowhead/list", async (c) => c.json(await store.names("wowhead/", c.req.query("cursor") || undefined)));
app.post("/api/wowhead/read", async (c) => {
  const { names: wanted } = (await c.req.json().catch(() => ({}))) as { names?: unknown };
  if (!Array.isArray(wanted) || wanted.length > 50 || !wanted.every((n) => typeof n === "string" && n.startsWith("wowhead/")))
    return c.json({ error: "names: wowhead/…, 50 at most" }, 400);
  const items = await Promise.all(wanted.map(async (name) => ({ name, pages: JSON.parse((await store.read(name)) ?? "{}") })));
  return c.json({ items });
});
app.post("/api/wowhead/done", async (c) => {
  const { names: done } = (await c.req.json().catch(() => ({}))) as { names?: unknown };
  if (!Array.isArray(done) || !done.every((n) => typeof n === "string" && n.startsWith("wowhead/"))) return c.json({ error: "names: wowhead/…" }, 400);
  await store.remove(done);
  return c.json({ removed: done.length });
});
