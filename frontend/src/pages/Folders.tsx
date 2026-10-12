import { FolderPlus, HardDrive, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader, Switch } from "@/components/ui";
import { useApp } from "@/lib/app";

/** The game folders found (and their accounts, each sent or not), the ones added by hand, and a way to add one. */
export function Folders() {
  const { state, t, api, run } = useApp();
  const [path, setPath] = useState("");
  const siteName = Object.fromEntries((state.sites ?? []).map((s) => [s.id, s.name]));
  const off = new Set(state.excludedAccounts ?? []);
  const installs = state.installs ?? [];
  const byHand = state.folders ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t.folders.title}
        intro={t.folders.intro}
        action={
          <button type="button" className="btn btn-gold shrink-0" onClick={() => run(() => api.ChooseFolder())}>
            <FolderPlus className="size-4" aria-hidden />
            {t.folders.add}
          </button>
        }
      />
      {installs.length === 0 && <p className="panel p-6 text-center text-dim">{t.folders.none}</p>}
      {installs.map((i) => (
        <section key={i.path} className="panel p-5">
          <h2 className="flex items-center gap-2">
            <HardDrive className="size-4 shrink-0 text-gold" aria-hidden />
            <span className="font-semibold text-gold">{i.label}</span>
          </h2>
          <p className="mt-0.5 truncate font-mono text-xs text-faint select-text">{i.path}</p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {(i.accounts ?? []).map((a) => {
              const ran = Object.keys(a.files ?? {}).filter((id) => (a.files?.[id] ?? []).length);
              return (
                <li key={a.dir} className="flex items-center gap-3">
                  <Switch on={!off.has(a.dir)} label={a.name} onChange={(on) => run(() => api.SetAccountSent(a.dir, on))} />
                  <span className="font-medium">{a.name}</span>
                  <span className="text-sm text-faint">· {ran.length ? t.folders.ran(ran.map((id) => siteName[id] ?? id).join(", ")) : t.folders.noFile}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section className="panel p-5">
        {byHand.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-dim">{t.folders.byHand}</h2>
            <ul className="mt-2 mb-4 flex flex-col gap-1.5">
              {byHand.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-dim select-text">{f}</span>
                  <button type="button" className="btn btn-ghost h-7 px-2" onClick={() => run(() => api.RemoveFolder(f))} aria-label={`${t.folders.remove}: ${f}`}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const p = path.trim();
            if (p) void run(() => api.AddFolder(p)).then(() => setPath(""));
          }}
        >
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t.folders.pathPlaceholder} className="field min-w-0 flex-1 font-mono text-xs" spellCheck={false} />
          <button type="submit" className="btn" disabled={!path.trim()}>
            <Plus className="size-4" aria-hidden />
            {t.folders.addPath}
          </button>
        </form>
        <p className="mt-3 text-xs text-faint">{t.folders.addonHint}</p>
      </section>
    </div>
  );
}
