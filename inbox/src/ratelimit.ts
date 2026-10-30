import { createHash } from "node:crypto";

/**
 * Limits kept in this function's memory: nothing written to Blob, each
 * instance its own count, so a flood spread over many instances gets through
 * in part. They make a script's work slower and keep a stray loop from
 * filling the store; the real gate is Vercel's firewall rule on /api/ping
 * and /api/facts (README). Addresses are hashed, never kept as they are.
 */
const windows = new Map<string, { n: number; until: number }>();
const daily = new Map<string, Set<string>>();

/** One more hit for `key` in `bucket`: true while it's within `limit` per `ms`. */
export function hit(bucket: string, key: string, limit: number, ms: number, now = Date.now()): boolean {
  const k = `${bucket}:${key}`;
  const w = windows.get(k);
  if (!w || w.until <= now) {
    if (windows.size > 50_000) for (const [name, old] of windows) if (old.until <= now) windows.delete(name);
    windows.set(k, { n: 1, until: now + ms });
    return true;
  }
  return ++w.n <= limit;
}

/** `value` seen for `key` today: true while the day holds at most `limit` different ones. */
export function distinct(bucket: string, key: string, value: string, limit: number, day: string): boolean {
  const k = `${day}:${bucket}:${key}`;
  let seen = daily.get(k);
  if (!seen) {
    // (yesterday's sets go when a new day starts)
    for (const name of daily.keys()) if (!name.startsWith(`${day}:`)) daily.delete(name);
    daily.set(k, (seen = new Set()));
  }
  if (seen.has(value)) return true;
  if (seen.size >= limit) return false;
  seen.add(value);
  return true;
}

/** The address a request came from, hashed (Vercel's own header first). */
export function addressOf(header: (name: string) => string | undefined): string {
  let ip = (header("x-vercel-forwarded-for") ?? header("x-forwarded-for") ?? header("x-real-ip") ?? "local").split(",")[0].trim();
  // (an IPv6 address by its /64: one home's or one server's whole block)
  if (ip.includes(":")) ip = expand(ip).slice(0, 4).join(":");
  return createHash("sha256").update(`ravenpost:${ip}`).digest("hex").slice(0, 16);
}

/** An IPv6 address's eight groups, "::" filled in. */
function expand(ip: string): string[] {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t].map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
}

export function resetLimits(): void {
  windows.clear();
  daily.clear();
}
