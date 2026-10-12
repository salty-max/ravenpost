// Small formatting helpers: times as "2 minutes ago", the game's class colours.

/** "2 minutes ago", "yesterday", then a date: from an ISO time. */
export function ago(iso: string | undefined, locale: string, never: string, now = Date.now()): string {
  if (!iso) return never;
  const at = Date.parse(iso);
  if (Number.isNaN(at) || at <= 0) return never;
  const s = Math.max(0, (now - at) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (s < 45) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), "day");
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(at);
}

/** The game's class colours, for names (a class the list doesn't know: the ink's). */
const CLASS: Record<string, string> = {
  WARRIOR: "#c69b6d",
  PALADIN: "#f48cba",
  HUNTER: "#aad372",
  ROGUE: "#fff468",
  PRIEST: "#ffffff",
  SHAMAN: "#2a8cf0",
  MAGE: "#3fc7eb",
  WARLOCK: "#8788ee",
  DRUID: "#ff7c0a",
  DEATHKNIGHT: "#c41e3a",
  MONK: "#00ff98",
};

export const classColour = (cls: string | undefined) => (cls && CLASS[cls]) || "var(--color-parchment)";
