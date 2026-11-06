import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Game, Owned } from "./passport";

/**
 * Who shares: a Battle.net account, signed in through the inbox (no
 * database: what it hands Ravenpost is signed, and only checked after).
 *   GET /api/login?port=&nonce=   Ravenpost opens the browser here; on to Battle.net
 *   GET /api/login/callback       Battle.net's way back: the account, a token, and
 *                                 back to Ravenpost on this computer
 *                                 (http://127.0.0.1:<port>/linked?token=&nonce=)
 * The token holds the account as `sub`, a keyed hash of its Battle.net id
 * (INBOX_SECRET: the id can't be found from it), and its BattleTag for
 * Ravenpost to show. An account that misbehaves is refused by its `sub`
 * (INBOX_BLOCKED, comma-separated).
 *
 * Everything signed here says what it is for (`typ`), and is taken for that
 * alone: `share` (the sharing token, 90 days, traded for a fresh one by
 * Ravenpost before then: POST /api/token/refresh), `stats` (the dashboard's
 * cookie), `state` (a sign-in on its way through Battle.net), `code` (two
 * minutes in the address back to Ravenpost, traded for the token over https:
 * POST /api/login/exchange, so the browser's history keeps no token).
 * A token from before kinds (no `typ`, no `exp`) is a sharing token until 90
 * days after it was made, and nothing else. A sharing token carries when its
 * account first signed in (`auth`) through every refresh, and none is
 * refreshed past a year of it: a token taken from someone dies within 90
 * days of its last refresh, and every one within a year and 90 days.
 * The owner API's own pair (src/owner.ts): `owner` (the Watchtower app's
 * token, read only, 30 days, renewed while the app is used, never past a year
 * of the first sign-in) and `ownercode` (its two minutes' code, traded the
 * same way as `code`). Neither works anywhere a sharing token or the stats
 * cookie does, nor the reverse; both are signed with INBOX_SECRET as the rest.
 * The code is bound to the Ravenpost that asked (`chl`, a hash of a secret
 * it keeps, shown only to the exchange: PKCE's way), so an address read from
 * the history buys nothing even within its two minutes.
 */
const secret = () => {
  const s = process.env.INBOX_SECRET;
  if (s) return s;
  if (process.env.VERCEL) throw new Error("INBOX_SECRET not set");
  return "local-only-secret";
};
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (data: string) => createHmac("sha256", secret()).update(data).digest();

export type Typ = "share" | "stats" | "state" | "code" | "owner" | "ownercode";
export const SHARE_DAYS = 90;
/** How long after the first sign-in a sharing token may still be refreshed. */
export const REFRESH_DAYS = 365;

/** A payload signed as it is, no kind: only the tests' tokens from before kinds. `signAs` for anything real. */
export function signUntyped(payload: Record<string, unknown>): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(body))}`;
}

export const signAs = (typ: Typ, payload: Record<string, unknown>) => signUntyped({ typ, ...payload });

/** A signed payload of this kind, if the signature holds and it hasn't expired. */
export function verify<T extends Record<string, unknown>>(token: string, typ: Typ): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let payload: T & { typ?: string; exp?: number; iat?: number; sub?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  const now = Date.now() / 1000;
  // (from before kinds: a sharing token, ending 90 days after it was made)
  if (payload.typ === undefined && typ === "share" && typeof payload.iat === "number" && typeof payload.sub === "string" && payload.exp === undefined)
    return payload.iat + SHARE_DAYS * 86400 < now ? null : payload;
  if (payload.typ !== typ || typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}

/** An account's name in the inbox: its Battle.net id, keyed. */
export const subOf = (bnetId: number | string) => createHmac("sha256", secret()).update(`bnet:${bnetId}`).digest("hex").slice(0, 24);

/** A sharer: their account's hash, BattleTag, and when they first signed in (`auth`; a token from before has its `iat`). */
export type Sharer = { sub: string; tag: string; auth?: number; iat?: number };
export const tokenFor = (s: Sharer) => {
  const iat = Math.floor(Date.now() / 1000);
  return signAs("share", { sub: s.sub, tag: s.tag, auth: s.auth ?? iat, iat, exp: iat + SHARE_DAYS * 86400 });
};
/** A fresh token for this one, or null once its first sign-in is a year old (then sign in again). */
export function refreshed(s: Sharer): string | null {
  const auth = s.auth ?? s.iat;
  if (typeof auth !== "number" || auth + REFRESH_DAYS * 86400 < Date.now() / 1000) return null;
  return tokenFor({ sub: s.sub, tag: s.tag, auth });
}
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
/** A Ravenpost's challenge: the base64url SHA-256 of its secret verifier. */
export const isChallenge = (c: string | undefined): c is string => !!c && /^[A-Za-z0-9_-]{43}$/.test(c);
/** The two minutes' code that stands for a sharer in the address back to Ravenpost (no token in it), bound to its challenge. */
export const codeFor = (s: Sharer, chl: string) => signAs("code", { sub: s.sub, tag: s.tag, chl, exp: Math.floor(Date.now() / 1000) + 120 });

const blocked = (sub: string) =>
  (process.env.INBOX_BLOCKED ?? "")
    .split(",")
    .map((x) => x.trim())
    .includes(sub);

/** The sharer a code stands for, or null (expired, forged, blocked, not a code, not this Ravenpost's verifier). */
export function redeem(code: string, verifier: string): Sharer | null {
  const s = verify<Sharer & { chl: string }>(code, "code");
  if (!s || typeof s.sub !== "string" || typeof s.tag !== "string" || typeof s.chl !== "string" || blocked(s.sub)) return null;
  const want = Buffer.from(s.chl);
  const got = Buffer.from(challengeOf(verifier));
  return got.length === want.length && timingSafeEqual(got, want) ? { sub: s.sub, tag: s.tag } : null;
}

/** The sharer a request's bearer token names, or null (none, forged, blocked). */
export function sharer(authorization: string | undefined): Sharer | null {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const s = token ? verify<Sharer>(token, "share") : null;
  if (!s || typeof s.sub !== "string") return null;
  return blocked(s.sub) ? null : s;
}

// ── the owner's token (the owner API, src/owner.ts) ──────────────────────────
export const OWNER_DAYS = 30;
/** How long after the first sign-in an owner token may still be renewed. */
export const OWNER_REFRESH_DAYS = 365;
const DEV_OWNER = "Tester#1234";

/** The BattleTags that may see the dashboard and the owner API (STATS_BATTLETAGS, comma-separated). The inbox's own dev account counts on this computer only. */
export function statsAllowed(tag: string): boolean {
  if (process.env.INBOX_DEV === "1" && !process.env.VERCEL && tag === DEV_OWNER) return true;
  return (process.env.STATS_BATTLETAGS ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .includes(tag.toLowerCase());
}

export type OwnerToken = { tag: string; auth: number; iat: number };
const ownerToken = (o: { tag: string; auth?: number }): { token: string; expires: number } => {
  const iat = Math.floor(Date.now() / 1000);
  const expires = iat + OWNER_DAYS * 86400;
  return { token: signAs("owner", { tag: o.tag, auth: o.auth ?? iat, iat, exp: expires }), expires };
};
/** A new owner token for a BattleTag that just signed in. */
export const ownerTokenFor = (tag: string) => ownerToken({ tag });
/** A fresh token for this one, or null once its first sign-in is a year old (then sign in again). */
export function ownerRefreshed(o: OwnerToken): { token: string; expires: number } | null {
  return o.auth + OWNER_REFRESH_DAYS * 86400 < Date.now() / 1000 ? null : ownerToken(o);
}
/** The two minutes' code that stands for the owner in the address back to the app (no token in it), bound to its challenge. */
export const ownerCodeFor = (tag: string, chl: string) => signAs("ownercode", { tag, chl, exp: Math.floor(Date.now() / 1000) + 120 });
/** The BattleTag an owner code stands for, or null (expired, forged, not an owner code, not on the list, not this app's verifier). */
export function redeemOwner(code: string, verifier: string): string | null {
  const c = verify<{ tag: string; chl: string }>(code, "ownercode");
  if (!c || typeof c.tag !== "string" || typeof c.chl !== "string" || !statsAllowed(c.tag)) return null;
  const want = Buffer.from(c.chl);
  const got = Buffer.from(challengeOf(verifier));
  return got.length === want.length && timingSafeEqual(got, want) ? c.tag : null;
}

/**
 * OWNER_REVOKED_BEFORE: every owner token made before this (an ISO time or
 * epoch seconds) is refused, the cookie and the web untouched. Set but not a
 * time: every owner token refused, the safe way to read a typo.
 */
function revokedBefore(): number | null {
  const v = process.env.OWNER_REVOKED_BEFORE?.trim();
  if (!v) return null;
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v) / 1000;
  return Number.isFinite(t) ? t : Infinity;
}

/** The owner a request's bearer token names, or null (none, forged, expired, revoked, no longer on the list). */
export function ownerFrom(authorization: string | undefined): OwnerToken | null {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const o = token ? verify<OwnerToken>(token, "owner") : null;
  if (!o || typeof o.tag !== "string" || typeof o.iat !== "number" || typeof o.auth !== "number" || !statsAllowed(o.tag)) return null;
  const cut = revokedBefore();
  return cut !== null && o.iat < cut ? null : o;
}

// ── Battle.net ───────────────────────────────────────────────────────────────
export const origin = () => (process.env.INBOX_ORIGIN ?? "http://localhost:3003").replace(/\/$/, "");
/** Where Battle.net sends the player back: registered on develop.battle.net. */
export const redirectUri = () => `${origin()}/api/login/callback`;

function credentials() {
  const id = process.env.BNET_CLIENT_ID;
  const secret = process.env.BNET_CLIENT_SECRET;
  if (!id || !secret) throw new Error("BNET_CLIENT_ID / BNET_CLIENT_SECRET not set");
  return { id, secret };
}

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({ client_id: credentials().id, redirect_uri: redirectUri(), response_type: "code", scope: "openid wow.profile", state });
  return `https://oauth.battle.net/authorize?${q}`;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (input, init) => fetch(input, init);
export const setFetch = (f: FetchFn) => {
  fetchImpl = f;
};

/** Characters whose realm and name go in the passport. */
const MAX_DETAILED = 100;

export const REGIONS = ["us", "eu", "kr", "tw"] as const;

type Headers = { Authorization: string };

/** One region's characters on one game's profile, or null (404 for a region never played, an error, a timeout). */
async function profile(region: string, game: Game, headers: Headers) {
  const r = await fetchImpl(`https://${region}.api.blizzard.com/profile/user/wow?namespace=profile-${game}-${region}&locale=en_GB`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const p = (await r.json().catch(() => null)) as { wow_accounts?: { characters?: unknown[] }[] } | null;
  return (p?.wow_accounts ?? []).flatMap((a) => a.characters ?? []);
}

async function classicList(region: string, headers: Headers): Promise<Owned> {
  const chars = ((await profile(region, "classic1x", headers)) ?? []) as { id: number; name?: string; realm?: { slug?: string } }[];
  return {
    region,
    ids: chars.map((ch) => ch.id),
    // (compact, for the redirect's URL: WoWLocker wants each one's realm and name)
    characters: chars.flatMap((ch): [number, string, string][] => (ch.realm?.slug && ch.name ? [[ch.id, ch.realm.slug, ch.name]] : [])),
  };
}

/**
 * Forever's list has no realm object: its pseudo-realm is the first number of
 * the protected link (".../protected-character/6946-550204", realm 6946,
 * character 550204). Only that exact shape counts, and its second number must
 * be the character's own id; anything else is no realm (the id still lists).
 */
export function foreverRealm(href: unknown, id: number): string | null {
  const m = typeof href === "string" ? href.match(/\/protected-character\/(\d{1,9})-(\d{1,12})(?:[?#].*)?$/) : null;
  return m && Number(m[2]) === id ? m[1] : null;
}

async function foreverList(region: string, headers: Headers): Promise<Owned> {
  const chars = ((await profile(region, "forever", headers)) ?? []) as {
    id: number;
    name?: string;
    surname?: string;
    protected_character?: { href?: string };
  }[];
  return {
    region,
    game: "forever",
    ids: chars.map((ch) => ch.id),
    // ([id, pseudo-realm id as a string, "Name Surname"]: the realm's slot, as Classic has its slug)
    characters: chars.flatMap((ch): [number, string, string][] => {
      const realm = foreverRealm(ch.protected_character?.href, ch.id);
      const name = [ch.name, ch.surname].filter(Boolean).join(" ");
      return realm && name ? [[ch.id, realm, name]] : [];
    }),
  };
}

/**
 * The account behind a one-time code: its id (stable), BattleTag and the
 * characters it owns in each region (Classic Era's profile, as Hearthtale's
 * own sign-in reads it, and Forever's list beside it: a separate entry, `game: "forever"`). The access token is dropped at once.
 */
export async function account(code: string): Promise<{ id: number; battletag: string; owned: Owned[] } | null> {
  const c = credentials();
  const res = await fetchImpl("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${c.id}:${c.secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`oauth code exchange → ${res.status}`);
  const { access_token } = (await res.json()) as { access_token: string };
  const auth = { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) };
  const info = await fetchImpl("https://oauth.battle.net/userinfo", auth);
  if (!info.ok) return null;
  const { id, battletag } = (await info.json()) as { id?: number; battletag?: string };
  if (!id) return null;
  // (every region at once, Classic and Forever side by side: a region the account never played answers 404, and one failing never fails the other)
  const lists = await Promise.all(
    REGIONS.flatMap((region) => [classicList(region, auth.headers), foreverList(region, auth.headers)]),
  );
  const owned = lists.filter((o) => o.ids.length);
  // (the passport rides in a URL, and Hearthtale refuses one over 20,000 characters: details for the first 100 only, the ids stay whole)
  // (Forever's first: a site counts a Forever character as owned only through its detail, Classic's ids stand alone)
  let room = MAX_DETAILED;
  for (const o of [...owned].sort((a, b) => Number(b.game === "forever") - Number(a.game === "forever"))) {
    o.characters = o.characters?.slice(0, room);
    room -= o.characters?.length ?? 0;
  }
  return { id, battletag: battletag ?? "", owned };
}
