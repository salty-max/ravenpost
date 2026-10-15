import { randomBytes } from "node:crypto";
import * as store from "./store";

/**
 * The inbox: each upload a file, until wow-data's daily job has merged it and
 * says so (then it goes).
 *   inbox/<game>/<ISO time>-<random>.json  { who, at, facts: [[locale, kind, entity, field, value, build], ...] }
 */
export type Upload = { who: string; at: string; facts: [string, string, string, string, string, string | null][] };
export type Item = Upload & { name: string };

const isOurs = (n: string) => /^inbox\/(classic|forever)\/[\w-]+\.json$/.test(n);

/** An upload into the inbox; its name. */
export async function drop(game: string, upload: Upload): Promise<string> {
  const name = `inbox/${game}/${upload.at.replace(/[:.]/g, "-")}-${randomBytes(6).toString("hex")}.json`;
  await store.write(name, JSON.stringify(upload));
  return name;
}

/** A page of a game's uploads, names and sizes, the oldest first; `cursor` for the next page. */
export const names = (game: string, cursor?: string) => store.names(`inbox/${game}/`, cursor);

/** These uploads' contents (wow-data asks for a few megabytes at a time). */
export async function read(wanted: string[]): Promise<Item[]> {
  const items: Item[] = [];
  for (const name of wanted.filter(isOurs)) {
    const text = await store.read(name);
    if (!text) throw new Error(`${name}: not in the inbox`);
    items.push({ name, ...(JSON.parse(text) as Upload) });
  }
  return items;
}

/** Uploads merged by wow-data: out of the inbox. */
export async function remove(done: string[]): Promise<number> {
  const ours = done.filter(isOurs);
  await store.remove(ours);
  return ours.length;
}
