import { FolderOpen, Home, Puzzle, Settings, Users } from "lucide-react";
import { useApp } from "@/lib/app";

export type Page = "overview" | "characters" | "addons" | "folders" | "settings";

/**
 * The window's left side: the raven and the name (under macOS's traffic
 * lights), the pages, and at the bottom how things stand right now.
 */
export function Sidebar({ page, go }: { page: Page; go: (p: Page) => void }) {
  const { state, t, mac } = useApp();
  const pages = [
    { id: "overview", label: t.nav.overview, icon: Home },
    { id: "characters", label: t.nav.characters, icon: Users, count: new Set((state.characters ?? []).map((c) => c.guid)).size },
    { id: "addons", label: t.nav.addons, icon: Puzzle },
    { id: "folders", label: t.nav.folders, icon: FolderOpen },
    { id: "settings", label: t.nav.settings, icon: Settings },
  ] as const;
  // (a site linked, or the addons' database: something to watch for)
  const linked = (state.sites ?? []).some((s) => s.linked) || !!state.facts?.linked;
  const uploading = (state.uploading ?? []).length > 0;
  return (
    <aside className="drag flex w-56 shrink-0 flex-col border-r border-edge bg-stone/80 pt-12">
      <div className="flex items-center gap-3 px-5 pb-6">
        <img src="/icon.png" alt="" width={40} height={40} className="size-10 rounded-[9px] shadow-[0_0_14px_rgb(242_193_78/0.25)]" />
        <div className="min-w-0">
          <p className="title text-lg leading-tight">Ravenpost</p>
          <p className="text-xs text-faint">v{state.version}</p>
        </div>
      </div>
      <nav className="no-drag flex flex-col gap-0.5 px-3" aria-label="Ravenpost">
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => go(p.id)}
            aria-current={page === p.id ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
              page === p.id ? "bg-gold/10 text-gold" : "text-dim hover:bg-white/[0.04] hover:text-parchment"
            }`}
          >
            <p.icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{p.label}</span>
            {"count" in p && p.count > 0 && <span className="text-xs text-faint">{p.count}</span>}
          </button>
        ))}
      </nav>
      <div className="mt-auto px-5 pb-5">
        <p className="flex items-center gap-2 text-[13px]">
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${uploading ? "pulse-dot bg-gold" : linked ? "pulse-dot bg-ok" : "bg-faint"}`}
          />
          <span className={uploading ? "text-gold" : "text-dim"}>
            {uploading ? t.status.uploading((state.uploading ?? []).join(", ")) : linked ? t.status.watching : t.status.notLinked}
          </span>
        </p>
        <p className="mt-2 text-xs leading-snug text-faint">{mac ? t.close.hint : t.close.hintWin}</p>
      </div>
    </aside>
  );
}
