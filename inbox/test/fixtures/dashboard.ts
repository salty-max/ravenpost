import type { Thread } from "../../src/comments";
import type { Reading, Release } from "../../src/curseforge";
import type { Event } from "../../src/events";
import type { Resolution } from "../../src/github";
import type { GitHubRelease } from "../../src/launch";
import type { History, Today, UniquePeriods } from "../../src/stats";

/**
 * One fixed day of the inbox's data, every part filled: the same fixtures
 * feed the old page's golden test and the owner API's tests. Nothing here is
 * a real player: the install hashes and subs are made-up strings the privacy
 * tests look for in every response.
 */
export const NOW = Date.parse("2026-10-29T11:00:00Z");

const day = (n: number) => new Date(Date.parse("2026-10-20T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

export const history: History = {
  updated: "2026-10-29T05:17:30Z",
  days: Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => {
      const d = day(i);
      return [
        d,
        {
          downloads: {
            Yonder: { curseforge: 1000 + i * 40, wago: 300 + i * 9, github: 120 + i * 3 },
            "Lorekeeper's Codex": { curseforge: 800 + i * 25, wago: 200 + i * 5 },
            Keyring: { curseforge: 90 + i * 4 },
            Ravenpost: { github: 60 + i * 6 },
            ...(i >= 4 ? { Mealbook: { curseforge: 10 + (i - 4) * 30, github: 2 } } : {}),
          },
          downloadsAt: `${d}T05:17:00Z`,
          ravenpost: {
            installs: 20 + i * 3,
            versions: { "0.5.2": 15 + i, "0.5.1": 5 },
            os: { macOS: 14 + i, Windows: 6 + i },
            linked: { Hearthtale: 9, Yonder: 7 },
            sharing: 8,
            ...(i >= 5 ? { distinct: { week: 30 + i, month: 52 + i, ever: 70 + i, newWeek: 4, newMonth: 11, since: day(0) } } : {}),
          },
          sharing: { sharers: 4 + i, uploads: 6 + i, facts: 200 + i * 31, games: { classic: 150 + i * 20, forever: 50 + i * 11 }, locales: { enUS: 180 + i * 25, frFR: 20 + i * 6 } },
          ...(i % 3 === 0 ? { merged: { classic: { uploads: 3, newFacts: 12 + i } } } : {}),
          traffic: { hearthtale: { pageviews: 100 + i * 7, visitors: 40 + i * 3 }, "wow-locker": { pageviews: 20 + i, visitors: 9 + i } },
          curseforge: { Yonder: { rank: 4000 - i * 30, favorites: 20 + i }, Keyring: { rank: 12000 - i * 10, favorites: 3 }, Goodwill: { rank: 1_000_000 } },
          ...(i >= 3 ? { unique: { Yonder: { downloads: 38 + i, unique: 30 + i }, Keyring: { downloads: 4, unique: 4 } } } : {}),
        },
      ];
    }),
  ),
};

export const readings: Reading[] = [
  ["2026-10-28T23:50:00Z", { Yonder: 1330, Keyring: 120 }, { Yonder: { wago: 372, github: 144 } }],
  ["2026-10-29T00:10:00Z", { Yonder: 1334, Keyring: 120 }],
  ["2026-10-29T06:30:00Z", { Yonder: 1352, Keyring: 123 }],
  ["2026-10-29T10:00:00Z", { Yonder: 1371, Keyring: 125, "Second Wind": 4 }],
  ["2026-10-29T10:50:00Z", { Yonder: 1380, Keyring: 125, "Second Wind": 6 }, { Yonder: { wago: 380 }, Ravenpost: { github: 118 } }],
];

export const releases: Record<string, Release[]> = {
  Yonder: [{ id: 3, version: "v0.14.2", at: "2026-10-28T23:00:00Z", downloads: 18, type: 1 }],
  Keyring: [{ id: 4, version: "v0.3.0", at: "2026-10-22T09:00:00Z", downloads: 40, type: 1 }],
};

export const github: Record<string, GitHubRelease> = {
  Yonder: { tag: "v0.14.2", at: "2026-10-28T22:50:00Z", url: "https://github.com/salty-max/yonder/releases/tag/v0.14.2" },
  Keyring: { tag: "v0.3.1", at: "2026-10-26T09:00:00Z", url: "https://github.com/salty-max/keyring/releases/tag/v0.3.1" },
  Ravenpost: { tag: "v0.5.2", at: "2026-10-27T09:00:00Z", url: "https://github.com/salty-max/ravenpost/releases/tag/v0.5.2" },
};

export const today: Today = {
  at: "2026-10-29T10:50:00Z",
  day: "2026-10-29",
  installs: 31,
  sharing: 5,
  sharers: 5,
  uploads: 7,
  facts: 410,
  distinct: { week: 44, month: 63, ever: 81, newWeek: 5, newMonth: 12, since: "2026-10-20" },
  traffic: { hearthtale: { pageviews: 60, visitors: 21 }, "wow-locker": { pageviews: 9, visitors: 4 } },
};

export const unique: UniquePeriods = {
  at: "2026-10-29T10:03:00Z",
  through: "2026-10-27",
  periods: { "7": { Yonder: { downloads: 210, unique: 160 } }, "30": { Yonder: { downloads: 700, unique: 420 } }, "90": { Yonder: { downloads: 900, unique: 500 } } },
};

const PR = "https://github.com/salty-max/wow-data/pull/412";
const RUN = "https://github.com/salty-max/yonder/actions/runs/9001";
export const events: Event[] = [
  { at: "2026-10-29T08:30:00Z", kind: "failed", repo: "yonder", title: "Yonder's data job failed", body: "The generators stopped at expeditions.", url: RUN },
  { at: "2026-10-29T07:20:00Z", kind: "digest", title: "Good morning", body: "Yesterday: 12 downloads." },
  { at: "2026-10-29T07:00:00Z", kind: "waiting", repo: "wow-data", title: "Players' facts wait for a hand", body: "A pull request is over its size ceiling.", url: PR },
  { at: "2026-10-28T23:10:00Z", kind: "release", repo: "yonder", title: "Yonder v0.14.2 is live on CurseForge", body: "", url: "https://www.curseforge.com/wow/addons/yonder/files/3" },
  { at: "2026-10-28T20:00:00Z", kind: "comment", repo: "keyring", title: "A comment on Keyring", body: "Nice <b>work</b>", url: "https://www.curseforge.com/wow/addons/keyring/comments" },
  { at: "2026-10-28T05:40:00Z", kind: "merged", repo: "hearthtale", title: "Hearthtale's data merged", body: "3 tables changed.", url: "https://github.com/salty-max/hearthtale/pull/77" },
  { at: "2026-10-27T05:40:00Z", kind: "test", title: "Test", body: "" },
];
export const resolved: Record<string, Resolution> = {
  [PR]: { at: "2026-10-29T09:00:00Z", how: "merged" },
};

export const threads: Thread[] = [
  {
    addon: "Yonder",
    repo: "yonder",
    url: "https://www.curseforge.com/wow/addons/yonder/comments/501",
    id: 501,
    author: "Zandrel",
    text: "Does it work with <Classic Era>? & the riddles?",
    at: "2026-10-29T06:00:00Z",
    last: "2026-10-29T06:00:00Z",
    replies: [],
    answered: false,
  },
  {
    addon: "Keyring",
    repo: "keyring",
    url: "https://www.curseforge.com/wow/addons/keyring/comments/502",
    id: 502,
    author: "Mirelle",
    text: "Thanks, lovely.",
    at: "2026-10-27T10:00:00Z",
    last: "2026-10-27T12:00:00Z",
    replies: [{ author: "saltymax", text: "Glad you like it.", at: "2026-10-27T12:00:00Z", owner: true }],
    answered: true,
  },
];

/** Made-up strings standing for what the inbox keeps about one player: no response may carry any of them. */
export const SECRETS = {
  installHashes: ["a1b2c3d4e5f60718", "0f9e8d7c6b5a4938"],
  subs: ["3f2a9c7e1b4d5a6c8e0f1a2b", "9d8c7b6a5f4e3d2c1b0a9f8e"],
};

/** Every option the dashboard takes, as /stats gives them. */
export const dashboardOptions = {
  viewer: "Namzar#21586",
  events,
  pushKey: "BKey-public",
  devices: 2,
  readings,
  releases,
  threads,
  resolved,
  today,
  unique,
  github,
  now: NOW,
};
