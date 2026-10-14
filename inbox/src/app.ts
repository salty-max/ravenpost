import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { account, authorizeUrl, sharer, sign, subOf, tokenFor, verify } from "./auth";
import { flatten } from "./facts";
import { drop, names, read, remove } from "./inbox";

// Ravenpost's inbox: players sign in with Battle.net from Ravenpost, the
// facts they share come in, wow-data's daily job takes them out.
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
  const port = c.req.query("port");
  const nonce = c.req.query("nonce");
  if (!isPort(port) || !isNonce(nonce)) return c.html(page("Ravenpost", "This page opens from Ravenpost's window."), 400);
  const state = sign({ port: Number(port), nonce, exp: Math.floor(Date.now() / 1000) + 600 });
  // (on this computer only, INBOX_DEV=1: a test account, no Battle.net)
  if (process.env.INBOX_DEV === "1" && !process.env.VERCEL)
    return c.redirect(back(port!, { token: tokenFor({ sub: subOf("dev"), tag: "Tester#1234" }), nonce: nonce! }));
  if (!process.env.BNET_CLIENT_ID || !process.env.BNET_CLIENT_SECRET)
    return c.html(page("Ravenpost", "Signing in with Battle.net isn't open yet. Try again in a little while."), 503);
  return c.redirect(authorizeUrl(state));
});

app.get("/api/login/callback", async (c) => {
  const s = verify<{ port: number; nonce: string }>(c.req.query("state") ?? "");
  if (!s) return c.html(page("Ravenpost", "This sign-in has expired. Click Link with Battle.net in Ravenpost again."), 400);
  const code = c.req.query("code");
  if (!code) return c.redirect(back(s.port, { error: "denied", nonce: s.nonce }));
  const who = await account(code).catch(() => null);
  if (!who) return c.redirect(back(s.port, { error: "failed", nonce: s.nonce }));
  return c.redirect(back(s.port, { token: tokenFor({ sub: subOf(who.id), tag: who.battletag }), nonce: s.nonce }));
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
