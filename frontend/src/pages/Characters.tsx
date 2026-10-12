import { AlertTriangle } from "lucide-react";
import type { Character } from "../../bindings/github.com/salty-max/ravenpost/models";
import { PageHeader, Switch, useNow } from "@/components/ui";
import { useApp } from "@/lib/app";
import { ago, classColour } from "@/lib/format";

type Row = Character & { sites: Character[] };

/**
 * Every character a site's addon saved, the last played first: one row each
 * (a character on both sites has both answers), and whether it is sent.
 */
export function Characters() {
  const { state, t, locale, api, run } = useApp();
  const now = useNow();
  const siteName = Object.fromEntries((state.sites ?? []).map((s) => [s.id, s.name]));
  const excluded = new Set(state.excludedCharacters ?? []);
  const rows: Row[] = [];
  const byGuid = new Map<string, Row>();
  for (const c of state.characters ?? []) {
    let r = byGuid.get(c.guid);
    if (!r) {
      r = { ...c, sites: [] };
      byGuid.set(c.guid, r);
      rows.push(r);
    }
    if ((c.level || 0) > (r.level || 0)) r.level = c.level;
    r.sites.push(c);
  }
  const status = (c: Character) => {
    const s = t.characters.status;
    if (c.excluded) return <span className="text-faint">{s.off}</span>;
    switch (c.status) {
      case "synced":
        return <span className="text-ok">{s.synced(c.events)}</span>;
      case "saved":
        return <span className="text-ok">{s.saved(c.chapters)}</span>;
      case "unknown":
      case "unlinked":
      case "removed":
      case "invalid":
        return <span className="text-gold">{s[c.status]}</span>;
      default:
        return <span className="text-faint">{s.pending}</span>;
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.characters.title} intro={t.characters.intro} />
      {(state.errors ?? []).map((e) => (
        <p key={e} className="panel flex items-center gap-2 border-blood/40 px-4 py-3 text-blood">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="select-text">{e}</span>
        </p>
      ))}
      {rows.length === 0 ? (
        <p className="panel p-6 text-center text-dim">{t.characters.empty}</p>
      ) : (
        <ul className="panel divide-y divide-white/[0.05]">
          {rows.map((c) => {
            const sent = !excluded.has(c.guid);
            return (
              <li key={c.guid} className={`flex items-center gap-4 px-5 py-3.5 ${sent ? "" : "opacity-60"}`}>
                <Switch on={sent} label={`${t.characters.sent}: ${c.name}`} onChange={(on) => run(() => api.SetCharacterSent(c.guid, on))} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="truncate font-semibold" style={{ color: classColour(c.class) }}>
                      {c.name}
                    </span>
                    {c.level > 0 && <span className="text-sm text-dim">{t.characters.level(c.level)}</span>}
                  </p>
                  <p className="truncate text-xs text-faint">
                    {[c.realm, c.install, c.account].filter(Boolean).join(" · ")}
                    {c.lastSeen && ` · ${ago(c.lastSeen, locale, t.ago.never, now)}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
                  {c.sites.map((x) => (
                    <p key={x.service} className="flex items-center gap-2">
                      {status(x)}
                      <span className="tag">{siteName[x.service] ?? x.service}</span>
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {state.gone > 0 && <p className="text-sm text-faint">{t.characters.gone(state.gone)}</p>}
    </div>
  );
}
