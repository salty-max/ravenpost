import { describe, expect, it } from "bun:test";
import { encryptPayload } from "../src/webpush";

const enc = new TextEncoder();
const te = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(enc.encode(s));
const b64url = (u: Uint8Array): string => Buffer.from(u).toString("base64url");
function concat(...a: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of a) {
    o.set(x, p);
    p += x.length;
  }
  return o;
}

// Independent receiver-side decrypt per RFC 8291/8188 — what a browser does.
async function decrypt(
  uaPriv: CryptoKey,
  body: Uint8Array<ArrayBuffer>,
  uaPub: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPriv, 256));
  const ecdhKey = await crypto.subtle.importKey("raw", ecdh, "HKDF", false, ["deriveBits"]);
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: auth,
        info: concat(te("WebPush: info"), Uint8Array.of(0), uaPub, asPub),
      },
      ecdhKey,
      256,
    ),
  );
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cekBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: concat(te("Content-Encoding: aes128gcm"), Uint8Array.of(0)) },
    ikmKey,
    128,
  );
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: concat(te("Content-Encoding: nonce"), Uint8Array.of(0)) },
      ikmKey,
      96,
    ),
  );
  const cek = await crypto.subtle.importKey("raw", cekBits, { name: "AES-GCM" }, false, ["decrypt"]);
  const dec = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, ciphertext));
  return new TextDecoder().decode(dec.slice(0, dec.length - 1)); // strip the 0x02 delimiter
}

describe("webpush aes128gcm", () => {
  it("encrypts a payload the receiver can decrypt (RFC 8291 round-trip)", async () => {
    const client = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", client.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sub = { endpoint: "https://push.example/x", keys: { p256dh: b64url(uaPub), auth: b64url(auth) } };

    const msg = JSON.stringify({ title: "⚽ BUT — France 1-0 Angleterre", body: "Mbappé 23'", matchId: 399 });
    const body = await encryptPayload(sub, te(msg));

    expect(await decrypt(client.privateKey, body, uaPub, auth)).toBe(msg);
  });
});
