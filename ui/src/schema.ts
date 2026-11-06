import { z } from "zod";

/**
 * Ravenpost's owner API: what the inbox answers at /api/owner/*, and the one
 * place that says what shape it has. The inbox types its answers by these
 * (type imports only: nothing of this file is deployed with it), every screen
 * that reads the API checks what it gets against them, so a shape that moves
 * fails in a test, not on a page.
 *
 * Every object is strict: an extra key is an error, never passed on. That is
 * the privacy rule in code. The API answers with the same aggregate numbers the
 * dashboard shows and nothing about one player: no install hash, no `sub`, no
 * name of a file in the inbox. A new field is a deliberate line here.
 */
export const API_VERSION = 1;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const at = z.string().min(10).max(40);
const text = z.string().max(5000);
const count = z.number().int().nonnegative();
const N = z.number().nullable();
/** A number a day, null where nothing was counted. */
const perDay = z.array(N);
const counts = z.record(z.string(), z.number());
const url = z.string().max(500);

// ── parts ────────────────────────────────────────────────────────────────────
export const Standing = z.strictObject({
  tone: z.enum(["blood", "gold", "ok"]),
  icon: z.enum(["x", "clock", "check"]),
  title: text,
  line: text,
});

export const Distinct = z.strictObject({ week: count, month: count, ever: count, newWeek: count.nullable(), newMonth: count.nullable(), since: day });

const Channels = z.strictObject({ curseforge: z.number().optional(), wago: z.number().optional(), github: z.number().optional() });

export const Release = z.strictObject({ version: z.string().max(60), at, downloads: count, type: z.number().int() });
export const GitHubRelease = z.strictObject({ tag: z.string().max(60), at, url });
/** `key` is stable between looks (a drift names its release): a client that tells things once tells each key once. */
export const Check = z.strictObject({ key: z.string().max(120), level: z.enum(["ok", "warn", "good", "note"]), title: text, line: text });

export const Event = z.strictObject({
  at,
  kind: z.enum(["merged", "failed", "waiting", "release", "comment", "digest", "test"]),
  repo: z.string().max(80).optional(),
  /** The addon's name as the dashboard writes it, for the repository. */
  addon: z.string().max(80).optional(),
  title: text,
  body: text,
  url: url.optional(),
  /** What GitHub saw settle since, for a failed run or a waiting pull request. */
  settled: z.strictObject({ at, how: z.enum(["merged", "closed", "passed"]) }).optional(),
});

export const Reply = z.strictObject({ author: z.string().max(200), text, at, owner: z.boolean() });
export const Thread = z.strictObject({ addon: z.string().max(80), repo: z.string().max(80), url, author: z.string().max(200), text, at, last: at, replies: z.array(Reply), answered: z.boolean() });

// ── the six answers ──────────────────────────────────────────────────────────
/** GET /api/owner/summary: the headline, and a stamp for each part below (its ETag: a part that has not moved has the same one). */
export const Summary = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  /** The last day with numbers. */
  through: day.nullable(),
  standing: Standing,
  problems: z.strictObject({ failed: count, waiting: count }),
  figures: z.strictObject({
    downloads: z.strictObject({ total: count, today: N, week: N }),
    installs: z.strictObject({ last: N, today: N }),
    facts: z.strictObject({ last: N, today: N }),
    visitors: z.strictObject({ last: N, today: N, sites: z.array(z.string().max(80)) }),
  }),
  commentsWaiting: count,
  /** CurseForge's people counts: when they were last brought, and whether that is too long ago (the session may have expired). */
  unique: z.strictObject({ at: at.nullable(), through: day.nullable(), stale: z.boolean() }),
  /** The launch watch's checks that need a look. */
  warnings: z.array(Check),
  stamps: z.strictObject({ numbers: z.string(), players: z.string(), comments: z.string(), activity: z.string(), releases: z.string() }),
});

export const Ranges = ["7", "30", "90", "all"] as const;

/** GET /api/owner/numbers?range=7|30|90|all: the downloads, the daily series cut to the last days asked for, the 24 hours. */
export const Numbers = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  range: z.enum(Ranges),
  days: z.array(day),
  downloads: z.strictObject({
    /** Every addon with a count. */
    addons: z.array(z.string()),
    /** Every addon of the family, counted or not. */
    listed: z.array(z.string()),
    daily: z.record(z.string(), perDay),
    since: z.array(day.nullable()),
    totals: z.record(z.string(), z.number()),
    channels: z.record(z.string(), Channels),
    week: z.record(z.string(), N),
    early: z.array(z.boolean()),
    stores: z.strictObject({ curseforge: perDay, wago: perDay, github: perDay }),
  }),
  unique: z.record(z.string(), perDay),
  rank: z.record(z.string(), perDay),
  /** Different people over the last 7, 30 and 90 days, by addon. */
  periods: z.record(z.string(), z.record(z.string(), z.strictObject({ downloads: count, unique: count }))),
  hourly: z.strictObject({ hours: z.array(z.string()), series: z.record(z.string(), perDay), today: N, readings: count }),
  /** The releases to mark on the chart. */
  marks: z.array(z.strictObject({ day, addon: z.string(), text: z.string() })),
  /** When the ten-minute readings were last taken. */
  checkedAt: at.nullable(),
  uniqueAt: at.nullable(),
});

/** GET /api/owner/players: Ravenpost in use, the facts shared, the sites' visitors. */
export const Players = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  days: z.array(day),
  installs: perDay,
  installsWeek: perDay,
  facts: perDay,
  sharers: perDay,
  newFacts: perDay,
  sites: z.record(z.string(), z.strictObject({ visitors: perDay, pageviews: perDay })),
  ravenpost: z.strictObject({ installs: count, versions: counts, os: counts, linked: counts }).nullable(),
  distinct: z.strictObject({ counts: Distinct, to: day }).nullable(),
  sharing: z.strictObject({ games: counts, locales: counts }).nullable(),
  today: z.strictObject({ at, day, installs: count, sharers: count, uploads: count, facts: count, visitors: N }).nullable(),
});

/** GET /api/owner/comments: CurseForge's threads, newest first. */
export const Comments = z.strictObject({ apiVersion: z.literal(API_VERSION), waiting: count, threads: z.array(Thread) });

/** GET /api/owner/activity: what the workflows told, newest first, and how things stand. */
export const Activity = z.strictObject({ apiVersion: z.literal(API_VERSION), standing: Standing, events: z.array(Event) });

/** GET /api/owner/releases: each addon on the stores, its rank, and the launch watch. */
export const Releases = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  /** Hours a release may be on GitHub before CurseForge being behind counts as a drift. */
  driftHours: count,
  /** The day the ranks' moves are measured from. */
  rankBase: day.nullable(),
  addons: z.array(
    z.strictObject({
      name: z.string(),
      repo: z.string(),
      hasCurseForge: z.boolean(),
      github: GitHubRelease.nullable(),
      curseforge: Release.nullable(),
      /** CurseForge's releases were read for this addon at all. */
      curseforgeRead: z.boolean(),
      job: z.strictObject({ kind: z.enum(["merged", "failed", "waiting"]), title: text, at }).nullable(),
      behind: z.strictObject({ hours: count }).nullable(),
      rank: z.strictObject({ now: count.nullable(), was: count.nullable(), isNew: z.boolean(), favorites: count.nullable() }).nullable(),
    }),
  ),
  checks: z.array(Check),
});

/** POST /api/owner/exchange and /api/owner/refresh: the token, and when it ends. */
export const TokenAnswer = z.strictObject({ token: z.string(), expires: count });

export type Summary = z.infer<typeof Summary>;
export type Numbers = z.infer<typeof Numbers>;
export type Players = z.infer<typeof Players>;
export type Comments = z.infer<typeof Comments>;
export type Activity = z.infer<typeof Activity>;
export type Releases = z.infer<typeof Releases>;
export type TokenAnswer = z.infer<typeof TokenAnswer>;
export type Range = (typeof Ranges)[number];

/** Each endpoint's path and its answer's schema: a client asks by this table. */
export const ENDPOINTS = {
  summary: { path: "/api/owner/summary", schema: Summary },
  numbers: { path: "/api/owner/numbers", schema: Numbers },
  players: { path: "/api/owner/players", schema: Players },
  comments: { path: "/api/owner/comments", schema: Comments },
  activity: { path: "/api/owner/activity", schema: Activity },
  releases: { path: "/api/owner/releases", schema: Releases },
} as const;
