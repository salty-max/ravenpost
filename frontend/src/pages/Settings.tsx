import { Code2, ExternalLink } from "lucide-react";
import { useState } from "react";
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

      <section className="panel p-5">
        <h2 className="title text-base">{t.settings.about}</h2>
        <p className="mt-2">{t.settings.version(state.version)}</p>
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
