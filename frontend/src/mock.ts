// A made-up state for working on the window in a plain browser (vite, ?mock):
// never in the app's build (lib/app.tsx imports it only in development).
import type { State } from "../bindings/github.com/salty-max/ravenpost/models";

const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

export function mockState(): State {
  const lang = new URLSearchParams(location.search).get("lang") ?? "en_FR";
  const fresh = new URLSearchParams(location.search).has("fresh");
  return {
    version: "0.3.0",
    language: lang,
    sites: [
      { id: "wowlocker", name: "WoWLocker", addon: "WowLocker", server: "https://wow-locker.app", linked: !fresh, battletag: "Max#1234", pairing: null },
      {
        id: "hearthtale",
        name: "Hearthtale",
        addon: "Hearthtale",
        server: "https://hearthtale.app",
        linked: !fresh,
        battletag: fresh ? "" : "Max#1234",
        pairing: null,
      },
    ],
    launchAtLogin: true,
    folders: ["/Volumes/Games/World of Warcraft"],
    excludedAccounts: [],
    excludedCharacters: ["Player-1-0002"],
    installs: fresh
      ? []
      : [
          {
            path: "/Applications/World of Warcraft/_classic_era_",
            flavour: "_classic_era_",
            label: "Classic Era · Hardcore · Season",
            accounts: [
              { name: "MAXIME", dir: "/a/MAXIME", files: { wowlocker: ["x"], hearthtale: ["y", "z"] } },
              { name: "ALT#2", dir: "/a/ALT", files: {} },
            ],
            addons: [
              { folder: "Hearthtale", name: "Hearthtale", version: "0.12.8", data: true },
              { folder: "LorekeepersCodex", name: "Lorekeeper's Codex", version: "0.15.2", data: true },
              { folder: "Yonder", name: "Yonder", version: "0.14.2", data: false },
              { folder: "WowLocker", name: "WoWLocker", version: "", data: true },
            ],
          },
          { path: "/Applications/World of Warcraft/_forever_", flavour: "_forever_", label: "World of Warcraft: Forever", accounts: [{ name: "MAXIME", dir: "/b/MAXIME", files: { hearthtale: ["w"] } }], addons: [{ folder: "Yonder", name: "Yonder", version: "0.14.2", data: true }, { folder: "Goodwill", name: "Goodwill", version: "0.2.0", data: false }] },
        ],
    characters: fresh
      ? []
      : [
          { service: "hearthtale", guid: "Player-1-0001", name: "Brannok", realm: "Nightslayer", class: "HUNTER", level: 9, account: "MAXIME", install: "Classic Era · Hardcore · Season", excluded: false, status: "saved", events: 0, chapters: 3, lastSeen: min(4) },
          { service: "wowlocker", guid: "Player-1-0001", name: "Brannok", realm: "Nightslayer", class: "HUNTER", level: 9, account: "MAXIME", install: "Classic Era · Hardcore · Season", excluded: false, status: "synced", events: 12, chapters: 0, lastSeen: min(4) },
          { service: "wowlocker", guid: "Player-1-0003", name: "Pippa", realm: "Soulseeker", class: "MAGE", level: 6, account: "MAXIME", install: "Classic Era · Hardcore · Season", excluded: false, status: "unknown", events: 0, chapters: 0, lastSeen: min(180) },
          { service: "hearthtale", guid: "Player-1-0003", name: "Pippa", realm: "Soulseeker", class: "MAGE", level: 6, account: "MAXIME", install: "Classic Era · Hardcore · Season", excluded: false, status: "unlinked", events: 0, chapters: 0, lastSeen: min(180) },
          { service: "wowlocker", guid: "Player-1-0002", name: "Grashnak", realm: "Firemaw", class: "WARRIOR", level: 24, account: "MAXIME", install: "Classic Era · Hardcore · Season", excluded: true, status: "", events: 0, chapters: 0, lastSeen: min(60 * 26) },
          { service: "hearthtale", guid: "Player-1-0004", name: "Sylvaine", realm: "Zephras", class: "DRUID", level: 31, account: "MAXIME", install: "World of Warcraft: Forever", excluded: false, status: "saved", events: 0, chapters: 14, lastSeen: min(60 * 50) },
        ],
    gone: fresh ? 0 : 1,
    lastSync: fresh ? undefined : min(4),
    update: new URLSearchParams(location.search).has("update") ? { version: "0.5.0", url: "https://github.com/salty-max/ravenpost/releases/latest" } : undefined,
    errors: [],
    uploading: [],
    lastUploaded: [],
    facts: { id: "shared", name: "The addons' database", addon: "", server: "http://localhost:3003", linked: !fresh, battletag: fresh ? "" : "Max#1234", pairing: null },
    sharing: fresh
      ? []
      : [
          { addon: "Yonder", account: "MAXIME", install: "World of Warcraft: Forever", seen: 1874, waiting: 0, at: min(4) },
          { addon: "Lorekeeper's Codex", account: "MAXIME", install: "Classic Era · Hardcore · Season", seen: 312, waiting: 26, at: min(60 * 26) },
        ],
    activity: fresh
      ? []
      : [
          { at: min(4), kind: "sent", service: "hearthtale", name: "Brannok", detail: "saved", chapters: 3 },
          { at: min(4), kind: "sent", service: "wowlocker", name: "Brannok", detail: "synced", events: 12 },
          { at: min(4), kind: "shared", service: "shared", name: "MAXIME", events: 214 },
          { at: min(180), kind: "refused", service: "hearthtale", name: "Pippa", detail: "unlinked" },
          { at: min(60 * 26), kind: "failed", service: "wowlocker", name: "MAXIME", detail: "the site didn't answer" },
          { at: min(60 * 50), kind: "sent", service: "hearthtale", name: "Sylvaine", detail: "saved", chapters: 14 },
          { at: min(60 * 72), kind: "linked", service: "wowlocker", name: "Max#1234" },
        ],
  } as State;
}

/** The bound service, played locally: each call changes the made-up state. */
export function mockApi(set: (fn: (s: State | null) => State | null) => void) {
  const change = (fn: (s: State) => void) => {
    set((s) => {
      if (!s) return s;
      const next = structuredClone(s);
      fn(next);
      return next;
    });
    return Promise.resolve();
  };
  const toggle = (list: string[] | null, v: string, on: boolean) => [...(list ?? []).filter((x) => x !== v), ...(on ? [v] : [])];
  return {
    State: () => Promise.resolve(mockState()),
    Link: (site: string) =>
      change((s) =>
        [...(s.sites ?? []), ...(s.facts ? [s.facts] : [])]
          .filter((x) => x.id === site)
          .forEach((x) => (x.pairing = { code: "R4V-3NP", url: x.server, status: "waiting" })),
      ),
    Unlink: (site: string) =>
      change((s) =>
        [...(s.sites ?? []), ...(s.facts ? [s.facts] : [])].filter((x) => x.id === site).forEach((x) => ((x.linked = false), (x.battletag = ""))),
      ),
    SyncNow: () => change((s) => (s.uploading = ["Brannok"])).then(() => setTimeout(() => change((s) => ((s.uploading = []), (s.lastSync = new Date().toISOString()), (s.lastUploaded = [{ service: "hearthtale", name: "Brannok", events: 0 }]))), 1500)),
    SetCharacterSent: (guid: string, sent: boolean) => change((s) => (s.excludedCharacters = toggle(s.excludedCharacters, guid, !sent))),
    SetAccountSent: (dir: string, sent: boolean) => change((s) => (s.excludedAccounts = toggle(s.excludedAccounts, dir, !sent))),
    ChooseFolder: () => change((s) => (s.folders = [...(s.folders ?? []), "/Users/max/Games/WoW"])),
    AddFolder: (path: string) => change((s) => (s.folders = [...(s.folders ?? []), path])),
    RemoveFolder: (path: string) => change((s) => (s.folders = (s.folders ?? []).filter((f) => f !== path))),
    SetLaunchAtLogin: (on: boolean) => change((s) => (s.launchAtLogin = on)),
    SetServer: (site: string, server: string) => change((s) => (s.sites ?? []).filter((x) => x.id === site).forEach((x) => ((x.server = server), (x.linked = false)))),
    Diagnostics: () => Promise.resolve("Ravenpost 0.3.0 (darwin/arm64), language en_GB\nOpen at login: yes\nLinked: Battle.net yes, WoWLocker yes, Hearthtale yes\nSharing: 2 addon file(s) with the opt-in on\n\nWorld of Warcraft: Forever (_forever_)\n  ~/Applications/World of Warcraft/_forever_\n  accounts: 1, left out: 0\n  Yonder v0.14.2, file saved: yes\n  Goodwill v0.2.0, file saved: no\n"),
    Open: (url: string) => (window.open(url, "_blank"), Promise.resolve()),
  };
}
