import { createHash } from "node:crypto";
import * as store from "./store";
import { sendPush, type PushSub, type PushUrgency, type Vapid } from "./webpush";

/**
 * The owner's devices told (the dashboard's notifications): each browser's
 * push subscription a file, push/<hash of its endpoint>.json, sent to by Web
 * Push (webpush.ts, Hearthtale's and WoWLocker's). Without the inbox's VAPID
 * keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT), none.
 */
export function vapid(): Vapid | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT ?? "https://ravenpost-inbox.vercel.app" };
}

export type Message = { title: string; body: string; url?: string; tag?: string };
type Saved = PushSub & { tag: string; at: string };

const nameOf = (endpoint: string) => `push/${createHash("sha256").update(endpoint).digest("hex").slice(0, 24)}.json`;

/** A subscription as the browser gives it (PushSubscription.toJSON()), checked. */
export function readSub(body: unknown): PushSub | null {
  const b = body as Partial<PushSub> | null;
  if (!b || typeof b.endpoint !== "string" || b.endpoint.length > 1000 || !b.endpoint.startsWith("https://")) return null;
  const k = b.keys as Partial<PushSub["keys"]> | undefined;
  const b64 = (s: unknown, max: number) => typeof s === "string" && s.length <= max && /^[A-Za-z0-9_-]+=*$/.test(s);
  if (!k || !b64(k.p256dh, 200) || !b64(k.auth, 100)) return null;
  return { endpoint: b.endpoint, keys: { p256dh: k.p256dh!, auth: k.auth! } };
}

export async function subscribe(sub: PushSub, tag: string): Promise<void> {
  const saved: Saved = { ...sub, tag, at: new Date().toISOString() };
  await store.write(nameOf(sub.endpoint), JSON.stringify(saved));
}

export async function unsubscribe(endpoint: string): Promise<void> {
  await store.remove([nameOf(endpoint)]);
}

export async function devices(): Promise<number> {
  return (await store.all("push/")).length;
}

/** Every device told; the ones the push service says are gone, forgotten. */
export async function notify(m: Message, opts: { ttl?: number; urgency?: PushUrgency } = {}): Promise<{ sent: number; gone: number }> {
  const keys = vapid();
  if (!keys) return { sent: 0, gone: 0 };
  let sent = 0;
  const gone: string[] = [];
  for (const name of await store.all("push/")) {
    const s = JSON.parse((await store.read(name)) ?? "null") as Saved | null;
    if (!s) continue;
    try {
      const res = await sendPush(s, m, keys, { ttl: opts.ttl ?? 24 * 3600, urgency: opts.urgency ?? "normal" });
      if (res.gone) gone.push(name);
      else if (res.ok) sent++;
      else console.error(JSON.stringify({ push: "refused", status: res.status }));
    } catch (err) {
      console.error(JSON.stringify({ push: "error", err: String(err) }));
    }
  }
  await store.remove(gone);
  return { sent, gone: gone.length };
}
