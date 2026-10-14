import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";

/**
 * The inbox: each upload a file, until wow-data's daily job has merged it and
 * says so (then it goes). A private Vercel Blob store in production
 * (BLOB_READ_WRITE_TOKEN or the project's OIDC store), a folder on this
 * computer otherwise (INBOX_DIR, default .inbox/).
 *   inbox/<game>/<ISO time>-<random>.json  { who, at, facts: [[locale, kind, entity, field, value, build], ...] }
 */
export type Upload = { who: string; at: string; facts: [string, string, string, string, string, string | null][] };
export type Item = Upload & { name: string };

const blob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const folder = () => process.env.INBOX_DIR ?? path.join(import.meta.dir, "..", ".inbox");

/** An upload into the inbox; its name. */
export async function drop(game: string, upload: Upload): Promise<string> {
  const name = `inbox/${game}/${upload.at.replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}.json`;
  const body = JSON.stringify(upload);
  if (blob()) await put(name, body, { access: "private", contentType: "application/json" });
  else {
    const f = path.join(folder(), name);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
  return name;
}

/** A page of a game's uploads, names and sizes, the oldest first; `cursor` for the next page. */
export async function names(game: string, cursor?: string): Promise<{ names: { name: string; size: number }[]; cursor: string | null }> {
  const prefix = `inbox/${game}/`;
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

/** These uploads' contents (wow-data asks for a few megabytes at a time). */
export async function read(wanted: string[]): Promise<Item[]> {
  const items: Item[] = [];
  for (const name of wanted.filter(isOurs)) items.push({ name, ...(JSON.parse(await readOne(name)) as Upload) });
  return items;
}

const isOurs = (n: string) => /^inbox\/(classic|forever)\/[\w-]+\.json$/.test(n);

async function readOne(name: string): Promise<string> {
  if (!blob()) return readFileSync(path.join(folder(), name), "utf8");
  const res = await get(name, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) throw new Error(`${name}: not in the inbox`);
  return await new Response(res.stream).text();
}

/** Uploads merged by wow-data: out of the inbox. */
export async function remove(done: string[]): Promise<number> {
  const ours = done.filter(isOurs);
  if (!ours.length) return 0;
  if (blob()) for (let i = 0; i < ours.length; i += 100) await del(ours.slice(i, i + 100));
  else for (const n of ours) rmSync(path.join(folder(), n), { force: true });
  return ours.length;
}
