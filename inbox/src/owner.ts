import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Activity, Comments, Numbers, Players, Range, Releases, Summary } from "./owner-schema";
import { recentThreads, type Thread } from "./comments";
import * as curseforge from "./curseforge";
import type { Reading, Release } from "./curseforge";
import { REPO_NAMES } from "./digest";
import * as events from "./events";
import type { Event } from "./events";
import * as github from "./github";
import type { Resolution } from "./github";
import { checks as launchChecks, DRIFT_HOURS, githubLatest, type GitHubRelease } from "./launch";
import { addonStatus, lastOf, marksOf, openProblems, overviewOf, standing, standingRows, type N } from "./numbers";
import { addressOf, hit } from "./ratelimit";
import { ADDONS, history, today, uniquePeriods, type History, type Today, type UniquePeriods } from "./stats";
import { ownerFrom, ownerRefreshed, ownerTokenFor, redeemOwner } from "./auth";

/**
 * The owner API: what the dashboard shows, as JSON, for the apps that draw it
 * themselves (the phone's, Watchtower on the Mac). Read only. Six GETs under
 * /api/owner/ (summary, numbers, players, comments, activity, releases), each
 * made by the same functions as the page (numbers.ts), shaped by
 * owner-schema.ts (a stamped copy of the one file in Watchtower's frontend: types here, the tests parse every answer against it), answered to the owner's cookie (the PWA) or to an owner
 * token (the Mac), nothing else. Each carries an ETag and answers 304 to an
 * If-None-Match that still holds: a quiet minute costs the client nothing.
 *
 *   POST /api/owner/exchange   an owner code and its verifier → a token
 *   POST /api/owner/refresh    a token (one that is not a year past its first
 *                              sign-in) → a fresh one
 *
 * It reaches no player: it has no route to the install hashes, a sharing
 * token's `sub` or the uploads, and its builders write each field by name,
 * checked against the strict schemas by the tests.
 * OWNER_API_OFF=1 makes all of it answer 404; OWNER_REVOKED_BEFORE refuses
 * the tokens made before a time (auth.ts).
 */
const API_VERSION = 1 as const;
const UNIQUE_STALE_HOURS = 3;

// ── what the endpoints read: the same as /stats ──────────────────────────────
export type Data = {
  h: History;
  today: Today | null;
  readings: Reading[];
  releases: Record<string, Release[]>;
  github: Record<string, GitHubRelease>;
  unique: UniquePeriods | null;
  events: Event[];
  resolved: Record<string, Resolution>;
  threads: Thread[];
  now: number;
};

const dayBefore = (n: number, now: number) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);

export async function load(now = Date.now()): Promise<Data> {
  // (the problems GitHub has seen settled since, asked as the page is made: a few seconds at most, each link at most every two minutes)
  const settled = events.recent().then(async (ev) => [ev, await github.settle(ev).catch(() => ({}))] as const);
  // (the day before too: the 24 hours before reach back into it)
  const [h, [ev, resolved], rb, r0, r1, releases, threads, td, unique, gh] = await Promise.all([
    history(),
    settled,
    curseforge.readings(dayBefore(2, now)),
    curseforge.readings(dayBefore(1, now)),
    curseforge.readings(dayBefore(0, now)),
    curseforge.latest(),
    recentThreads(),
    today(),
    uniquePeriods(),
    githubLatest(),
  ]);
  return { h, today: td, readings: [...rb, ...r0, ...r1], releases, github: gh, unique, events: ev, resolved, threads, now };
}

// ── the parts, from the data ─────────────────────────────────────────────────
const cut = <T>(xs: T[], from: number) => xs.slice(from);

/** The launch watch's checks as the API words them (`key` for the watch's own id: no key of an answer is named `id`). */
const checksOf = (d: Data) => launchChecks(d.h, d.today, d.github, d.releases, new Date(d.now)).map(({ id, level, title, line }) => ({ key: id, level, title, line }));

export function numbersOf(d: Data, range: Range = "all"): Numbers {
  const { s, hourly, downloadsChecked } = overviewOf(d.h, d);
  const from = range === "all" ? 0 : Math.max(0, s.days.length - Number(range));
  const days = cut(s.days, from);
  const perAddon = <T>(m: Record<string, T[]>) => Object.fromEntries(Object.entries(m).map(([a, xs]) => [a, cut(xs, from)]));
  const dl = s.downloads;
  return {
    apiVersion: API_VERSION,
    range,
    days,
    downloads: {
      addons: dl.addons,
      listed: [...dl.addons, ...ADDONS.map((a) => a[0]).filter((n) => !dl.addons.includes(n))],
      daily: perAddon(dl.daily),
      since: cut(dl.since, from) as (string | null)[],
      totals: dl.totals,
      channels: dl.channels,
      week: dl.week,
      early: cut(dl.early, from),
      stores: { curseforge: cut(dl.stores.curseforge, from), wago: cut(dl.stores.wago, from), github: cut(dl.stores.github, from) },
    },
    unique: perAddon(s.unique),
    rank: perAddon(s.rank),
    periods: d.unique?.periods ?? {},
    hourly,
    marks: marksOf(days, d.releases, d.github),
    checkedAt: downloadsChecked ?? null,
    uniqueAt: d.unique?.at ?? null,
  };
}

export function playersOf(d: Data): Players {
  const { s, td, rp, sh, distinct, distinctTo, visitorsToday } = overviewOf(d.h, d);
  return {
    apiVersion: API_VERSION,
    days: s.days,
    installs: s.installs,
    installsWeek: s.installsWeek,
    facts: s.facts,
    sharers: s.sharers,
    newFacts: s.newFacts,
    sites: s.sites,
    ravenpost: rp ? { installs: rp.installs, versions: rp.versions, os: rp.os, linked: rp.linked } : null,
    distinct: distinct && distinctTo ? { counts: distinct, to: distinctTo } : null,
    sharing: sh ? { games: sh.games, locales: sh.locales } : null,
    today: td ? { at: td.at, day: td.day, installs: td.installs, sharers: td.sharers, uploads: td.uploads, facts: td.facts, visitors: visitorsToday } : null,
  };
}

export function commentsOf(d: Data): Comments {
  return {
    apiVersion: API_VERSION,
    waiting: d.threads.filter((t) => !t.answered).length,
    // (as the page: the newest forty; the comment's own id stays here, nobody needs it)
    threads: d.threads.slice(0, 40).map(({ addon, repo, url, author, text, at, last, replies, answered }) => ({ addon, repo, url, author, text, at, last, replies, answered })),
  };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function activityOf(d: Data): Activity {
  return {
    apiVersion: API_VERSION,
    standing: standing(d.events, d.resolved, d.now),
    events: d.events.slice(0, 60).map((e) => {
      const done = (e.kind === "failed" || e.kind === "waiting") && e.url ? d.resolved[e.url] : undefined;
      return {
        at: e.at,
        kind: e.kind,
        ...(e.repo && { repo: e.repo, addon: cap(REPO_NAMES[e.repo] ?? e.repo) }),
        title: e.title,
        body: e.body,
        ...(e.url && { url: e.url }),
        ...(done && { settled: { at: done.at, how: done.how } }),
      };
    }),
  };
}

export function releasesOf(d: Data): Releases {
  const { rows, base } = standingRows(d.h, d.releases);
  const ranks = new Map(rows.map((r) => [r.name, r]));
  return {
    apiVersion: API_VERSION,
    driftHours: DRIFT_HOURS,
    rankBase: base ?? null,
    addons: addonStatus(d.github, d.releases, d.events, d.now).map((a) => {
      const r = ranks.get(a.name);
      return {
        name: a.name,
        repo: a.repo,
        hasCurseForge: a.hasCurseForge,
        github: a.github ? { tag: a.github.tag, at: a.github.at, url: a.github.url } : null,
        curseforge: a.curseforge ? { version: a.curseforge.version, at: a.curseforge.at, downloads: a.curseforge.downloads, type: a.curseforge.type } : null,
        curseforgeRead: a.read,
        job: a.job ? { kind: a.job.kind as "merged" | "failed" | "waiting", title: a.job.title, at: a.job.at } : null,
        behind: a.behind,
        rank: r ? { now: r.rank ?? null, was: r.was ?? null, isNew: !!(r.rank && !r.was && r.seen), favorites: r.fav ?? null } : null,
      };
    }),
    checks: checksOf(d),
  };
}

/** A body's ETag: a hash of the bytes sent, so it moves exactly when the answer does. */
export const etagOf = (body: string) => `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;

export function summaryOf(d: Data): Summary {
  const o = overviewOf(d.h, d);
  const p = openProblems(d.events, d.resolved, d.now);
  const stamp = (part: unknown) => etagOf(JSON.stringify(part));
  const uniqueAge = d.unique ? d.now - Date.parse(d.unique.at) : null;
  return {
    apiVersion: API_VERSION,
    through: o.lastDay ?? null,
    standing: standing(d.events, d.resolved, d.now),
    problems: { failed: p.failed.length, waiting: p.waiting.length },
    figures: {
      downloads: { total: o.total, today: o.hourly.today, week: o.week },
      installs: { last: o.rp?.installs ?? null, today: o.td?.installs ?? null },
      facts: { last: o.sh?.facts ?? null, today: o.td?.facts ?? null },
      visitors: { last: lastOf(o.visitors) as N, today: o.visitorsToday, sites: Object.keys(o.s.sites) },
    },
    commentsWaiting: d.threads.filter((t) => !t.answered).length,
    unique: { at: d.unique?.at ?? null, through: d.unique?.through ?? null, stale: uniqueAge !== null && (!Number.isFinite(uniqueAge) || uniqueAge > UNIQUE_STALE_HOURS * 3600_000) },
    warnings: checksOf(d).filter((c) => c.level !== "ok"),
    // (each part's own ETag, for its default question: a part whose stamp has not moved need not be asked again)
    stamps: { numbers: stamp(numbersOf(d)), players: stamp(playersOf(d)), comments: stamp(commentsOf(d)), activity: stamp(activityOf(d)), releases: stamp(releasesOf(d)) },
  };
}

// ── the routes ───────────────────────────────────────────────────────────────
type Deps = {
  /** The signed-in owner's BattleTag from the dashboard's cookie (renewing it as /stats does), or null. */
  cookie: (c: Context) => string | null;
};

const RANGES = ["7", "30", "90", "all"] as const;
const noneMatch = (header: string | undefined, tag: string) => !!header && header.split(",").some((t) => t.trim().replace(/^W\//, "") === tag || t.trim() === "*");

export function mountOwner(app: Hono, deps: Deps) {
  // The kill switch: the whole of it answers 404, as if it were not there.
  app.use("/api/owner/*", async (c, next) => {
    if (process.env.OWNER_API_OFF === "1") return c.json({ error: "not found" }, 404);
    await next();
  });

  // ── the sign-in's last step: the code from the address, traded for the token (a POST, over https, with the verifier only that app holds) ──
  app.post("/api/owner/exchange", bodyLimit({ maxSize: 4096 }), async (c) => {
    if (!hit("owner-exchange", addressOf((h) => c.req.header(h)), 10, 60_000)) return c.json({ error: "too many for now" }, 429);
    const { code, verifier } = (await c.req.json().catch(() => ({}))) as { code?: unknown; verifier?: unknown };
    const tag = typeof code === "string" && typeof verifier === "string" ? redeemOwner(code, verifier) : null;
    return tag ? c.json(ownerTokenFor(tag)) : c.json({ error: "this sign-in has expired" }, 400);
  });

  // A token still good, traded for a fresh one, up to a year after the first sign-in.
  app.post("/api/owner/refresh", async (c) => {
    const me = ownerFrom(c.req.header("authorization"));
    if (!me) return c.json({ error: "sign in with Battle.net" }, 401);
    if (!hit("owner-refresh", me.tag, 5, 60_000)) return c.json({ error: "too many for now" }, 429);
    const fresh = ownerRefreshed(me);
    return fresh ? c.json(fresh) : c.json({ error: "sign in again" }, 403);
  });

  // ── the six GETs: the cookie or the token ──
  app.use("/api/owner/*", async (c, next) => {
    // (every method but the two sign-in POSTs is judged: Hono runs a GET's handler for a HEAD too)
    if (c.req.method === "POST") return next();
    const given = c.req.header("authorization");
    // (a token given is the one judged: a bad one never falls back to a cookie)
    const who = given ? ownerFrom(given)?.tag : deps.cookie(c);
    if (!who) return c.json({ error: "sign in with Battle.net" }, 401);
    if (!hit("owner", who, 120, 60_000)) return c.json({ error: "too many for now" }, 429);
    await next();
  });

  const answer = (c: Context, part: unknown) => {
    const body = JSON.stringify(part);
    const tag = etagOf(body);
    c.header("ETag", tag);
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Authorization, Cookie");
    if (noneMatch(c.req.header("if-none-match"), tag)) return c.body(null, 304);
    return c.body(body, 200, { "Content-Type": "application/json; charset=UTF-8" });
  };

  app.get("/api/owner/summary", async (c) => answer(c, summaryOf(await load())));
  app.get("/api/owner/numbers", async (c) => {
    const range = c.req.query("range") ?? "all";
    if (!(RANGES as readonly string[]).includes(range)) return c.json({ error: "range: 7, 30, 90 or all" }, 400);
    return answer(c, numbersOf(await load(), range as Range));
  });
  app.get("/api/owner/players", async (c) => answer(c, playersOf(await load())));
  app.get("/api/owner/comments", async (c) => answer(c, commentsOf(await load())));
  app.get("/api/owner/activity", async (c) => answer(c, activityOf(await load())));
  app.get("/api/owner/releases", async (c) => answer(c, releasesOf(await load())));
}
