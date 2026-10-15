import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";

/**
 * The inbox's files: a private Vercel Blob store on Vercel
 * (BLOB_READ_WRITE_TOKEN or the project's OIDC store), a folder on this
 * computer otherwise (INBOX_DIR, default .inbox/), whatever tokens a local
 * .env holds (INBOX_BLOB=1 to reach the store from here on purpose). Names are paths; a prefix
 * listed ends with "/".
 *   inbox/<game>/…      the uploads (inbox.ts)
 *   pings/<day>/…       Ravenpost's daily pings, one an install (stats.ts)
 *   counts/<day>/…      a day's uploads by sharer (stats.ts)
 *   stats/history.json  the numbers, a day at a time (stats.ts)
 */
// (Blob only on Vercel, or when asked: a token left in a local .env, which Bun
// loads by itself, must never make a run on this computer write to production)
const blob = () => (!!process.env.VERCEL || process.env.INBOX_BLOB === "1") && !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const folder = () => process.env.INBOX_DIR ?? path.join(import.meta.dir, "..", ".inbox");

export async function write(name: string, body: string): Promise<void> {
  if (blob()) await put(name, body, { access: "private", contentType: "application/json", allowOverwrite: true, cacheControlMaxAge: 60 });
  else {
    const f = path.join(folder(), name);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
}

/** A file's text, or null when there is none. */
export async function read(name: string): Promise<string | null> {
  if (!blob()) {
    try {
      return readFileSync(path.join(folder(), name), "utf8");
    } catch {
      return null;
    }
  }
  const res = await get(name, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return await new Response(res.stream).text();
}

/** A page of the names under a prefix, the oldest first; `cursor` for the next page. */
export async function names(prefix: string, cursor?: string): Promise<{ names: { name: string; size: number }[]; cursor: string | null }> {
  if (blob()) {
    const res = await list({ prefix, cursor, limit: 1000 });
    return { names: res.blobs.map((b) => ({ name: b.pathname, size: b.size })), cursor: res.hasMore ? (res.cursor ?? null) : null };
  }
  const dir = path.join(folder(), prefix);
  let all: string[] = [];
  try {
    all = readdirSync(dir).sort();
  } catch {}
  const from = cursor ? Number(cursor) : 0;
  const slice = all.slice(from, from + 1000);
  return {
    names: slice.map((f) => ({ name: prefix + f, size: statSync(path.join(dir, f)).size })),
    cursor: from + 1000 < all.length ? String(from + 1000) : null,
  };
}

/** Every name under a prefix. */
export async function all(prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let cursor: string | null | undefined; cursor !== null; ) {
    const page = await names(prefix, cursor ?? undefined);
    out.push(...page.names.map((n) => n.name));
    cursor = page.cursor;
  }
  return out;
}

export async function remove(list: string[]): Promise<void> {
  if (!list.length) return;
  if (blob()) for (let i = 0; i < list.length; i += 100) await del(list.slice(i, i + 100));
  else for (const n of list) rmSync(path.join(folder(), n), { force: true });
}
