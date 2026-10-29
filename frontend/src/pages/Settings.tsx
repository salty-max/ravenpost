import { Check, Code2, Copy, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import type { SiteState } from "../../bindings/github.com/salty-max/ravenpost/models";
import { PageHeader, Switch } from "@/components/ui";
import { useApp } from "@/lib/app";

/** Starting at login, each site's server, and what Ravenpost is. */
export function Settings() {
  const { state, t, mac, api, run } = useApp();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.settings.title} />
      <section className="panel flex items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t.settings.launch}</h2>
          <p className="mt-0.5 text-sm text-dim">{mac ? t.settings.launchWhy : t.settings.launchWhyWin}</p>
        </div>
        <Switch on={state.launchAtLogin} label={t.settings.launch} onChange={(on) => run(() => api.SetLaunchAtLogin(on))} />
      </section>

      <section className="panel p-5">
        <h2 className="font-semibold">{t.settings.servers}</h2>
        <p className="mt-0.5 text-sm text-dim">{t.settings.serversWhy}</p>
        <div className="mt-3 flex flex-col gap-2.5">
          {(state.sites ?? []).map((site) => (
            <ServerField key={site.id + site.server} site={site} />
          ))}
        </div>
      </section>

      <Diagnostics />

      <section className="panel p-5">
        <h2 className="title text-base">{t.settings.about}</h2>
        <p className="mt-2">{t.settings.version(state.version)}</p>
        {state.update && (
          <p className="mt-1 text-sm">
            <button type="button" className="text-gold underline underline-offset-2" onClick={() => run(() => api.Open(state.update!.url))}>
              {t.update.settings(state.update.version)}
            </button>
          </p>
        )}
        <p className="mt-1 text-sm text-dim">{t.settings.made}</p>
        <h3 className="mt-4 text-sm font-semibold text-dim">{t.settings.privacy}</h3>
        <p className="mt-1 max-w-2xl text-sm text-dim">{t.settings.privacyText}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(state.sites ?? []).map((s) => (
            <button key={s.id} type="button" className="btn" onClick={() => run(() => api.Open(s.server))}>
              <ExternalLink className="size-4" aria-hidden />
              {s.name}
            </button>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => run(() => api.Open("https://github.com/salty-max/ravenpost"))}>
            <Code2 className="size-4" aria-hidden />
            {t.settings.source}
          </button>
        </div>
      </section>
    </div>
  );
}

function ServerField({ site }: { site: SiteState }) {
  const { t, api, run } = useApp();
  const [value, setValue] = useState(site.server);
  const changed = value.trim() !== "" && value.trim() !== site.server;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed) void run(() => api.SetServer(site.id, value.trim()));
      }}
    >
      <span className="w-24 shrink-0 text-sm text-dim">{site.name}</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} className="field min-w-0 flex-1 font-mono text-xs" spellCheck={false} />
      <button type="submit" className="btn" disabled={!changed}>
        {t.settings.save}
      </button>
    </form>
  );
}

/** A redacted text of how things stand, to paste into an issue. */
function Diagnostics() {
  const { t, api, run } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const show = () => run(async () => setText(await api.Diagnostics()));
  const copy = async () => {
    box.current?.select();
    try {
      await navigator.clipboard.writeText(text ?? "");
      setCopied(true);
    } catch {
      setCopied(false); // (the text stays selected: the system's own copy)
    }
  };
  return (
    <section className="panel p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t.diagnostics.title}</h2>
          <p className="mt-0.5 text-sm text-dim">{t.diagnostics.why}</p>
        </div>
        {text === null ? (
          <button type="button" className="btn shrink-0" onClick={show}>
            {t.diagnostics.show}
          </button>
        ) : (
          <button type="button" className="btn btn-gold shrink-0" onClick={copy}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? t.diagnostics.copied : t.diagnostics.copy}
          </button>
        )}
      </div>
      {text !== null && (
        <>
          <textarea ref={box} readOnly value={text} rows={Math.min(18, text.split("\n").length + 1)} className="field mt-3 h-auto w-full resize-none py-2 font-mono text-xs select-text" spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          {copied === false && <p className="mt-1.5 text-xs text-faint">{t.diagnostics.copyFailed}</p>}
        </>
      )}
    </section>
  );
}
