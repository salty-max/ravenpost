/**
 * What players' games told them of the world (the addons' kit collector, for
 * those who said yes), sent by Ravenpost as an addon's collect table:
 *
 *   { game: "classic" | "forever", facts: { [locale]: {
 *       quest:  { [id]: { title, details, objectives, request, reward, giver, ender, map, x, y, b } },
 *       npc:    { [id]: { world: true, name, level: [lo, hi], rank, typeId, familyId, type, family, reaction, map, x, y, b } },
 *       say:    { [npc id]: { [text]: "say" | "yell" | "emote" | "whisper" } },
 *       gossip: { [npc id]: { [text]: true } },
 *       loot:   { ["npc:id" | "object:id"]: { looted, items: { [item id]: n } } } } } }
 *
 * Flattened into facts, each checked (a known game, language and kind, ids as
 * numbers, texts of a sensible length, positions on a map); anything else is
 * left out. The player's own name is already the game's token ($N): the
 * collector never keeps it. A word that is their class or race comes marked
 * ($C{Hunter}, $c{hunter}, $R{Night Elf}), kept as it is: wow-data's
 * players' facts resolve it (resolveMarks).
 */
export type Fact = { game: string; locale: string; kind: string; entity: string; field: string; value: string; build: string | null };

export const GAMES = new Set(["classic", "forever"]);
const LOCALES = new Set(["enUS", "enGB", "deDE", "frFR", "esES", "esMX", "ruRU", "ptBR", "itIT", "koKR", "zhCN", "zhTW"]);
const TEXT = 4000; // (a quest's longest text is well under)
const WORD = 64; // (a rank, a type, a family)
const MAX_FACTS = 60_000; // (a request's: Ravenpost sends a megabyte at a time)
const QUEST_TEXTS = ["title", "details", "objectives", "request", "reward"] as const;
const SAID = new Set(["say", "yell", "emote", "whisper"]);

const isId = (s: string) => /^\d{1,9}$/.test(s);
const isSource = (s: unknown): s is string => typeof s === "string" && /^(npc|object):\d{1,9}$/.test(s);
const text = (v: unknown, max = TEXT) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const build = (v: unknown) => (typeof v === "string" && /^\d{1,7}$/.test(v) ? v : typeof v === "number" ? String(v) : null);

/** Where a quest was taken or a creature met: its map and the place on it, 0-100. */
function where(e: Record<string, unknown>): string | null {
  const map = int(e.map, 1, 100_000);
  if (map === null) return null;
  const x = typeof e.x === "number" && e.x >= 0 && e.x <= 100 ? e.x : null;
  const y = typeof e.y === "number" && e.y >= 0 && e.y <= 100 ? e.y : null;
  return JSON.stringify(x !== null && y !== null ? [map, x, y] : [map]);
}

export function flatten(body: unknown): Fact[] | null {
  const b = obj(body);
  const game = b?.game;
  const facts = obj(b?.facts);
  if (typeof game !== "string" || !GAMES.has(game) || !facts) return null;
  const out: Fact[] = [];
  const put = (locale: string, kind: string, entity: string, field: string, value: string, at: string | null = null) => {
    if (out.length < MAX_FACTS) out.push({ game, locale, kind, entity, field, value, build: at });
  };
  for (const [locale, raw] of Object.entries(facts)) {
    const shelves = obj(raw);
    if (!LOCALES.has(locale) || !shelves) continue;
    for (const [id, raw] of Object.entries(obj(shelves.quest) ?? {})) {
      const q = obj(raw);
      if (!isId(id) || !q) continue;
      const at = build(q.b);
      for (const f of QUEST_TEXTS) {
        const v = text(q[f]);
        if (v) put(locale, "quest", id, f, v, at);
      }
      for (const f of ["giver", "ender"]) if (isSource(q[f])) put(locale, "quest", id, f, q[f] as string, at);
      const w = where(q);
      if (w) put(locale, "quest", id, "where", w, at);
    }
    for (const [id, raw] of Object.entries(obj(shelves.npc) ?? {})) {
      const n = obj(raw);
      // Old saved records may be summons with Creature GUIDs. Only the
      // collector that checks player control can attest a world NPC.
      if (!isId(id) || !n || n.world !== true) continue;
      const at = build(n.b);
      const name = text(n.name, 200);
      if (name) put(locale, "npc", id, "name", name, at);
      const level = Array.isArray(n.level) ? n.level.map((l) => int(l, 1, 100)) : [];
      if (level.length === 2 && level[0] !== null && level[1] !== null && level[0] <= level[1])
        put(locale, "npc", id, "level", JSON.stringify(level), at);
      for (const f of ["rank", "type", "family"]) {
        const v = text(n[f], WORD);
        if (v) put(locale, "npc", id, f, v, at);
      }
      for (const f of ["typeId", "familyId"]) {
        const value = int(n[f], 1, 100_000);
        if (value !== null) put(locale, "npc", id, f, String(value), at);
      }
      const reaction = int(n.reaction, 1, 8);
      if (reaction !== null) put(locale, "npc", id, "reaction", String(reaction), at);
      const w = where(n);
      if (w) put(locale, "npc", id, "where", w, at);
    }
    for (const [id, raw] of Object.entries(obj(shelves.say) ?? {})) {
      if (!isId(id)) continue;
      for (const [line, kind] of Object.entries(obj(raw) ?? {}))
        if (text(line) && typeof kind === "string" && SAID.has(kind)) put(locale, "say", id, kind, line);
    }
    for (const [id, raw] of Object.entries(obj(shelves.gossip) ?? {})) {
      if (!isId(id)) continue;
      for (const line of Object.keys(obj(raw) ?? {})) if (text(line)) put(locale, "gossip", id, "text", line);
    }
    for (const [source, raw] of Object.entries(obj(shelves.loot) ?? {})) {
      const l = obj(raw);
      if (!isSource(source) || !l) continue;
      for (const item of Object.keys(obj(l.items) ?? {})) if (isId(item)) put(locale, "loot", source, "item", item);
    }
  }
  return out;
}
