import { createPrivateKey, randomBytes, sign as edSign } from "node:crypto";
import { DEV_PRIVATE_KEY } from "./devkey";

/**
 * A passport: who signed in through Ravenpost, for the sites Ravenpost
 * carries for (Hearthtale; WoWLocker later), so one sign-in links them all.
 * The account's Battle.net id, its BattleTag and the characters it owns in
 * each region (Classic Era's profile: what Battle.net lists), signed with the
 * inbox's Ed25519 key (INBOX_SIGNING_KEY, PKCS#8 PEM). A site checks it with
 * the public key, which can't make one. Ten minutes, once: Ravenpost hands it
 * on at once.
 *   <base64url payload>.<base64url signature>
 *   { aud: "sites", bnetId, battletag, owned: [{ region, game?, ids, characters? }], iat, exp, jti }
 */
export type Game = "classic1x" | "forever";
/**
 * `game`: absent means classic1x (a passport from before Forever is unchanged).
 * `characters`: [id, realm slug, name] of the same characters, for the sites that keep them (WoWLocker).
 * Forever has no realms: its entry's second slot is the pseudo-realm id as a
 * string ("6946", from the protected link) and the name is "Name Surname".
 */
export type Owned = { region: string; game?: Game; ids: number[]; characters?: [number, string, string][] };
export type Passport = { aud: "sites"; bnetId: number; battletag: string; owned: Owned[]; iat: number; exp: number; jti: string };

function key() {
  const pem = process.env.INBOX_SIGNING_KEY;
  if (pem) return createPrivateKey(pem.replace(/\\n/g, "\n"));
  if (process.env.VERCEL) throw new Error("INBOX_SIGNING_KEY not set");
  return createPrivateKey(DEV_PRIVATE_KEY);
}

export function passportFor(who: { bnetId: number; battletag: string; owned: Owned[] }): string {
  const iat = Math.floor(Date.now() / 1000);
  const p: Passport = { aud: "sites", ...who, iat, exp: iat + 600, jti: randomBytes(12).toString("hex") };
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${edSign(null, Buffer.from(body), key()).toString("base64url")}`;
}
