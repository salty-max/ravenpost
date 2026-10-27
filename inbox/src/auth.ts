import { createHmac, timingSafeEqual } from "node:crypto";
import type { Owned } from "./passport";

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
 */
const secret = () => {
  const s = process.env.INBOX_SECRET;
  if (s) return s;
  if (process.env.VERCEL) throw new Error("INBOX_SECRET not set");
  return "local-only-secret";
};
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (data: string) => createHmac("sha256", secret()).update(data).digest();

export function sign(payload: Record<string, unknown>): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(body))}`;
}

/** A signed payload, if the signature holds and it hasn't expired. */
export function verify<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    return payload.exp && payload.exp < Date.now() / 1000 ? null : payload;
  } catch {
    return null;
  }
}

/** An account's name in the inbox: its Battle.net id, keyed. */
export const subOf = (bnetId: number | string) => createHmac("sha256", secret()).update(`bnet:${bnetId}`).digest("hex").slice(0, 24);

export type Sharer = { sub: string; tag: string };
export const tokenFor = (s: Sharer) => sign({ sub: s.sub, tag: s.tag, iat: Math.floor(Date.now() / 1000) });

/** The sharer a request's bearer token names, or null (none, forged, blocked). */
export function sharer(authorization: string | undefined): Sharer | null {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const s = token ? verify<Sharer>(token) : null;
  if (!s || typeof s.sub !== "string") return null;
  const blocked = (process.env.INBOX_BLOCKED ?? "").split(",").map((x) => x.trim());
  return blocked.includes(s.sub) ? null : s;
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

/**
 * The account behind a one-time code: its id (stable), BattleTag and the
 * characters it owns in each region (Classic Era's profile, as Hearthtale's
 * own sign-in reads it). The access token is dropped at once.
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
  // (every region at once: a region the account never played answers 404)
  const owned = (
    await Promise.all(
      REGIONS.map(async (region) => {
        const r = await fetchImpl(`https://${region}.api.blizzard.com/profile/user/wow?namespace=profile-classic1x-${region}&locale=en_GB`, {
          headers: auth.headers,
          signal: AbortSignal.timeout(20_000),
        }).catch(() => null);
        if (!r?.ok) return { region, ids: [] as number[] };
        const p = (await r.json()) as { wow_accounts?: { characters?: { id: number; name?: string; realm?: { slug?: string } }[] }[] };
        const chars = (p.wow_accounts ?? []).flatMap((a) => a.characters ?? []);
        return {
          region,
          ids: chars.map((ch) => ch.id),
          // (compact, for the redirect's URL: WoWLocker wants each one's realm and name)
          characters: chars.flatMap((ch): [number, string, string][] => (ch.realm?.slug && ch.name ? [[ch.id, ch.realm.slug, ch.name]] : [])),
        };
      }),
    )
  ).filter((o) => o.ids.length);
  // (the passport rides in a URL, and Hearthtale refuses one over 20,000 characters: details for the first 100 only, the ids stay whole)
  let room = MAX_DETAILED;
  for (const o of owned) {
    o.characters = o.characters?.slice(0, room);
    room -= o.characters?.length ?? 0;
  }
  return { id, battletag: battletag ?? "", owned };
}
