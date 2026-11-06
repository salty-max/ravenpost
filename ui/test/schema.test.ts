import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Activity, API_VERSION, Comments, ENDPOINTS, Numbers, Players, Releases, Summary, TokenAnswer } from "../src/schema";

/** The smallest valid answer of each, and what must fail: the schemas are the contract and the privacy rule at once. */
const standing = { tone: "ok", icon: "check", title: "All quiet", line: "Nothing yet." };
const thread = { addon: "Yonder", repo: "yonder", url: "https://www.curseforge.com/x", author: "Zandrel", text: "Hello", at: "2026-10-29T06:00:00Z", last: "2026-10-29T06:00:00Z", replies: [], answered: false };
const samples = {
  summary: {
    apiVersion: API_VERSION,
    through: "2026-10-28",
    standing,
    problems: { failed: 0, waiting: 0 },
    figures: {
      downloads: { total: 10, today: null, week: 3 },
      installs: { last: 4, today: null },
      facts: { last: null, today: null },
      visitors: { last: 2, today: 1, sites: ["hearthtale"] },
    },
    commentsWaiting: 1,
    unique: { at: null, through: null, stale: false },
    warnings: [{ key: "pings", level: "warn", title: "Pings down", line: "3 against 9." }],
    stamps: { numbers: '"a"', players: '"b"', comments: '"c"', activity: '"d"', releases: '"e"' },
  },
  numbers: {
    apiVersion: API_VERSION,
    range: "7",
    days: ["2026-10-28"],
    downloads: {
      addons: ["Yonder"],
      listed: ["Yonder", "Keyring"],
      daily: { Yonder: [4.5] },
      since: [null],
      totals: { Yonder: 10 },
      channels: { Yonder: { curseforge: 8, github: 2 } },
      week: { Yonder: null },
      early: [false],
      stores: { curseforge: [4], wago: [null], github: [0.5] },
    },
    unique: { Yonder: [3] },
    rank: { Yonder: [null] },
    periods: { "7": { Yonder: { downloads: 9, unique: 6 } } },
    hourly: { hours: ["2026-10-28T10:00:00.000Z"], series: { Yonder: [null] }, today: null, readings: 0 },
    marks: [{ day: "2026-10-28", addon: "Yonder", text: "Yonder v1" }],
    checkedAt: null,
    uniqueAt: null,
  },
  players: {
    apiVersion: API_VERSION,
    days: ["2026-10-28"],
    installs: [4],
    installsWeek: [null],
    facts: [9],
    sharers: [2],
    newFacts: [null],
    sites: { hearthtale: { visitors: [3], pageviews: [7] } },
    ravenpost: { installs: 4, versions: { "0.5.2": 4 }, os: { macOS: 3, Windows: 1 }, linked: { Yonder: 2 } },
    distinct: { counts: { week: 4, month: 4, ever: 4, newWeek: null, newMonth: null, since: "2026-10-20" }, to: "2026-10-28" },
    sharing: { games: { classic: 9 }, locales: { enUS: 9 } },
    today: null,
  },
  comments: { apiVersion: API_VERSION, waiting: 1, threads: [thread] },
  activity: { apiVersion: API_VERSION, standing, events: [{ at: "2026-10-29T08:00:00Z", kind: "failed", repo: "yonder", addon: "Yonder", title: "Failed", body: "", settled: { at: "2026-10-29T09:00:00Z", how: "passed" } }] },
  releases: {
    apiVersion: API_VERSION,
    driftHours: 6,
    rankBase: null,
    addons: [
      {
        name: "Yonder",
        repo: "yonder",
        hasCurseForge: true,
        github: { tag: "v1", at: "2026-10-28T10:00:00Z", url: "https://github.com/x" },
        curseforge: null,
        curseforgeRead: false,
        job: { kind: "merged", title: "Merged", at: "2026-10-28T05:00:00Z" },
        behind: { hours: 7 },
        rank: { now: 4000, was: null, isNew: true, favorites: null },
      },
    ],
    checks: [],
  },
} as const;

describe("the six answers", () => {
  for (const name of Object.keys(samples) as (keyof typeof samples)[]) {
    const schema = ENDPOINTS[name].schema;
    test(`${name}: the sample is valid, a stray key is not`, () => {
      expect(schema.safeParse(samples[name]).success).toBe(true);
      expect(schema.safeParse({ ...samples[name], sub: "3f2a9c7e1b4d5a6c8e0f1a2b" }).success).toBe(false);
      expect(schema.safeParse({ ...samples[name], apiVersion: API_VERSION + 1 }).success).toBe(false);
    });
  }

  test("a key nobody wrote is an error at every depth, not an answer", () => {
    const leaky = structuredClone(samples.comments) as any;
    leaky.threads[0].id = 501;
    expect(Comments.safeParse(leaky).success).toBe(false);
    const hashed = structuredClone(samples.players) as any;
    hashed.ravenpost.installHash = "a1b2c3d4e5f60718";
    expect(Players.safeParse(hashed).success).toBe(false);
    const sub = structuredClone(samples.activity) as any;
    sub.events[0].who = "x";
    expect(Activity.safeParse(sub).success).toBe(false);
  });

  test("a number where text is wanted, a missing part, a range outside the four", () => {
    expect(Summary.safeParse({ ...samples.summary, figures: { ...samples.summary.figures, downloads: { total: "10", today: null, week: 3 } } }).success).toBe(false);
    const { stamps: _, ...noStamps } = samples.summary;
    expect(Summary.safeParse(noStamps).success).toBe(false);
    expect(Numbers.safeParse({ ...samples.numbers, range: "forever" }).success).toBe(false);
    expect(Releases.safeParse({ ...samples.releases, addons: [{ ...samples.releases.addons[0], job: { kind: "release", title: "x", at: "2026-10-28T05:00:00Z" } }] }).success).toBe(false);
  });

  test("the token's answer is a token and when it ends", () => {
    expect(TokenAnswer.safeParse({ token: "a.b", expires: 1_800_000_000 }).success).toBe(true);
    expect(TokenAnswer.safeParse({ token: "a.b" }).success).toBe(false);
    expect(TokenAnswer.safeParse({ token: "a.b", expires: 1, tag: "Namzar#1" }).success).toBe(false);
  });

  test("the endpoint table: six paths under /api/owner/, each its own", () => {
    const paths = Object.values(ENDPOINTS).map((e) => e.path);
    expect(paths).toHaveLength(6);
    expect(new Set(paths).size).toBe(6);
    expect(paths.every((p) => p.startsWith("/api/owner/"))).toBe(true);
  });

  test("no field of any answer is named for a player, an install or a secret", () => {
    const names = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as { properties?: Record<string, unknown> };
      for (const [k, v] of Object.entries(n.properties ?? {})) {
        names.add(k);
        walk(v);
      }
      for (const v of Object.values(node as Record<string, unknown>)) if (v && typeof v === "object") walk(v);
    };
    for (const { schema } of Object.values(ENDPOINTS)) walk(z.toJSONSchema(schema));
    expect(names.size).toBeGreaterThan(60);
    // (record keys, like an addon's name, are not fields: only the fixed ones are walked)
    for (const forbidden of ["sub", "who", "hash", "hashes", "id", "ids", "install", "installId", "bnetId", "passport", "token", "secret", "battletag", "file", "files", "cookie"])
      expect(names.has(forbidden), forbidden).toBe(false);
  });
});
