import type { Activity } from "../../bindings/github.com/salty-max/ravenpost/models";
import type { Strings } from "@/lib/i18n";

/** One line of the journal, in words: "Brannok's journal sent, 3 entries". */
export function describe(t: Strings, a: Activity, site: string): string {
  const name = a.name ?? "";
  switch (a.kind) {
    case "sent":
      return a.service === "wowlocker" ? t.activity.sent.wowlocker(name, a.events ?? 0) : t.activity.sent.hearthtale(name, a.chapters ?? 0);
    case "refused": {
      const r = t.activity.refused;
      const f = a.detail === "unknown" ? r.unknown : a.detail === "unlinked" ? r.unlinked : a.detail === "removed" ? r.removed : a.detail === "invalid" ? r.invalid : null;
      return f ? f(name) : r.other(name, a.detail ?? "");
    }
    case "failed":
      return `${t.activity.failed(name)}${a.detail ? `: ${a.detail}` : ""}`;
    case "linked":
      return t.activity.linked(site, name);
    default:
      return t.activity.unlinked(site);
  }
}
