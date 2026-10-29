// What the page names: the repository, its releases, the files a release
// carries (release.yml's names), and the family's addons as Ravenpost knows
// them (addons.go's familyAddons, in its order).

export const REPO = "salty-max/ravenpost";
export const GITHUB = `https://github.com/${REPO}`;
export const LATEST = `${GITHUB}/releases/latest`;
export const RELEASES = `${GITHUB}/releases`;
export const ISSUES = `${GITHUB}/issues`;
export const KOFI = "https://ko-fi.com/salty_max";

export const ASSETS = {
  "windows-x64": "-windows-x64.exe",
  "windows-arm64": "-windows-arm64.exe",
  macos: "-macos.zip",
} as const;
export type Asset = keyof typeof ASSETS;

export interface Addon {
  name: string;
  url: string;
  what: string;
}

export const ADDONS: Addon[] = [
  { name: "Hearthtale", url: "https://hearthtale.app", what: "your character's diary, written as you play, to read on your phone" },
  { name: "Lorekeeper's Codex", url: "https://www.curseforge.com/wow/addons/lorekeepers-codex", what: "lore pages unlocked as you explore" },
  { name: "Yonder", url: "https://www.curseforge.com/wow/addons/yonder", what: "riddles, quarries, a bestiary and an atlas" },
  { name: "Second Wind", url: "https://www.curseforge.com/wow/addons/second-wind", what: "a debrief after each close call and death" },
  { name: "Keyring", url: "https://www.curseforge.com/projects/1739386", what: "every minimap button behind one key" },
  { name: "Palaver", url: "https://www.curseforge.com/wow/addons/palaver", what: "quest and NPC conversations, face to face" },
  { name: "Mealbook", url: "https://www.curseforge.com/wow/addons/mealbook", what: "a chef's cookbook and the road to 300" },
  { name: "Goodwill", url: "https://www.curseforge.com/wow/addons/goodwill", what: "every faction's road to Exalted" },
  { name: "Yours Truly", url: "https://www.curseforge.com/wow/addons/yours-truly", what: "letters from the people you helped" },
  { name: "WoWLocker", url: "https://wow-locker.app", what: "your characters and their gear, on the web" },
];
