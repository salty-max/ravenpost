import * as store from "./store";

/**
 * What happened, for the owner, in words: the daily data jobs' merges and
 * failures, a pull request waiting for a hand (players' facts, pins that
 * don't build), a release live on CurseForge (curseforge.ts), the players'
 * comments there (comments.ts), the morning's digest. Sent by the GitHub workflows (POST
 * /api/events with INBOX_EVENTS_TOKEN: wow-data's bin/tell.ts), told to the
 * owner's devices at once (push.ts), listed on the dashboard. One file,
 * events/recent.json, the newest first: 60 days, 300 at most.
 */
export const KINDS = ["merged", "failed", "waiting", "release", "comment", "digest", "test"] as const;
export type Kind = (typeof KINDS)[number];
export type Event = { at: string; kind: Kind; repo?: string; title: string; body: string; url?: string };

const FILE = "events/recent.json";
const KEEP_DAYS = 60;
const KEEP = 300;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/** An event as a workflow sends it, checked; null when it isn't one. */
export function readEvent(body: unknown, now = new Date()): Event | null {
  const b = body as Partial<Event> | null;
  if (!b || !KINDS.includes(b.kind as Kind)) return null;
  const title = text(b.title, 140);
  const words = text(b.body, 2000) ?? "";
  if (!title) return null;
  const repo = typeof b.repo === "string" && /^[\w.-]{1,60}$/.test(b.repo) ? b.repo : undefined;
  // (a link only to where the work is: GitHub, or the inbox itself)
  const url = typeof b.url === "string" && /^https:\/\/(github\.com\/salty-max\/|ravenpost-inbox\.vercel\.app\/)/.test(b.url) && b.url.length <= 300 ? b.url : undefined;
  return { at: now.toISOString(), kind: b.kind as Kind, ...(repo && { repo }), title, body: words, ...(url && { url }) };
}

export async function recent(): Promise<Event[]> {
  return JSON.parse((await store.read(FILE)) ?? "[]") as Event[];
}

export async function add(e: Event): Promise<void> {
  const cut = new Date(Date.parse(e.at) - KEEP_DAYS * 86_400_000).toISOString();
  const kept = (await recent()).filter((x) => x.at >= cut);
  await store.write(FILE, JSON.stringify([e, ...kept].slice(0, KEEP)));
}

/** The events since a moment, oldest first. */
export async function since(iso: string): Promise<Event[]> {
  return (await recent()).filter((e) => e.at > iso).reverse();
}
