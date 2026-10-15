// Copied from Hearthtale (apps/api/src/lib/webpush.ts, itself from WoWLocker): keep the three alike.
/**
 * Minimal, dependency-free Web Push — VAPID (RFC 8292) + aes128gcm payload
 * encryption (RFC 8291/8188) built on Web Crypto + fetch, so the exact same code
 * runs on the Node server and on Cloudflare Workers (the `web-push` npm package
 * relies on Node's `crypto`/`https` and won't run on Workers).
 */

const enc = new TextEncoder();

// UTF-8 encode into a fresh ArrayBuffer-backed view (Web Crypto's BufferSource
// wants `Uint8Array<ArrayBuffer>`, which `TextEncoder.encode` doesn't guarantee).
function te(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(enc.encode(s));
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...arrs: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

/** The `Authorization: vapid t=<jwt>, k=<key>` header for an endpoint's origin. */
async function vapidHeader(endpoint: string, vapid: Vapid): Promise<string> {
  const payload = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  };
  const signingInput =
    bytesToB64url(te(JSON.stringify({ typ: "JWT", alg: "ES256" }))) +
    "." +
    bytesToB64url(te(JSON.stringify(payload)));

  const pub = b64urlToBytes(vapid.publicKey); // 0x04 || x(32) || y(32)
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: vapid.privateKey,
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te(signingInput));
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${vapid.publicKey}`;
}

/** Encrypt a payload for a subscription per RFC 8291 (Content-Encoding: aes128gcm).
 *  Exported for the round-trip test; not part of the public surface. */
export async function encryptPayload(
  sub: PushSub,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(sub.keys.p256dh); // 65 bytes
  const authSecret = b64urlToBytes(sub.keys.auth); // 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey)); // 65 bytes

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  // Combine step: IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info"||0||ua||as).
  const ecdhKey = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, ["deriveBits"]);
  const keyInfo = concat(enc.encode("WebPush: info"), Uint8Array.of(0), uaPublic, asPublic);
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfo },
      ecdhKey,
      256,
    ),
  );

  // Content step: CEK + NONCE = HKDF(salt=salt, ikm=IKM, info="Content-Encoding: …").
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cekBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: concat(enc.encode("Content-Encoding: aes128gcm"), Uint8Array.of(0)) },
    ikmKey,
    128,
  );
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: concat(enc.encode("Content-Encoding: nonce"), Uint8Array.of(0)) },
      ikmKey,
      96,
    ),
  );
  const cek = await crypto.subtle.importKey("raw", cekBits, { name: "AES-GCM" }, false, ["encrypt"]);

  // Single record: plaintext || 0x02 delimiter, AES-128-GCM.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cek, concat(plaintext, Uint8Array.of(2))),
  );

  // Header: salt(16) || record_size(4=4096) || idlen(1=65) || as_public(65).
  const header = concat(salt, Uint8Array.of(0, 0, 0x10, 0x00), Uint8Array.of(65), asPublic);
  return concat(header, ciphertext);
}

export type SendResult = { ok: boolean; status: number; gone: boolean };

/**
 * RFC 8030 §5.3 message urgency. The push service uses it to decide whether a
 * message is worth waking a sleeping device for; APNs maps `high` to priority 10
 * (deliver now) and the lower levels to batched delivery. Live match alerts are
 * worthless late, so they ship `high`.
 */
export type PushUrgency = "very-low" | "low" | "normal" | "high";

/**
 * Deliver one push. `gone` = the subscription is dead (404/410) → drop it.
 *
 * `ttl` (seconds) is how long the push service may hold the message for a device
 * it can't reach — a phone with the screen off, in iOS low-power or Android Doze.
 * Past it the message is DISCARDED and never retried, so it has to cover the
 * window over which the notification is still worth reading (see `pushTtl`).
 */
export async function sendPush(
  sub: PushSub,
  payload: unknown,
  vapid: Vapid,
  { ttl = 60, urgency = "normal" }: { ttl?: number; urgency?: PushUrgency } = {},
): Promise<SendResult> {
  const body = await encryptPayload(sub, te(JSON.stringify(payload)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body: body as BodyInit,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
