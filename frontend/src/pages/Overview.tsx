import { AlertTriangle, Check, CheckCircle2, ExternalLink, FolderPlus, Link2, Loader2, RefreshCw, Share2, Unlink, XCircle } from "lucide-react";
import type { Share, SiteState } from "../../bindings/github.com/salty-max/ravenpost/models";
import { useNow } from "@/components/ui";
import { useApp } from "@/lib/app";
import { describe } from "@/lib/activity";
import { ago } from "@/lib/format";

/** The first page: how things stand, the two sites and the addons' database, what was sent lately. */
export function Overview() {
  return (
    <div className="flex flex-col gap-6">
      <Status />
      <section aria-labelledby="sites" className="grid grid-cols-2 gap-4">
        <h2 id="sites" className="sr-only">
          Sites
        </h2>
        <AccountCard />
        <SiteCards />
        <SharingCard />
      </section>
      <ActivityPanel />
    </div>
  );
}

/** The raven and a sentence: uploading, caught up, or what to do first. */
function Status() {
  const { state, t, locale, api, run } = useApp();
  const now = useNow();
  // (a site linked, or the addons' database: something to carry)
  const linked = (state.sites ?? []).some((s) => s.linked) || !!state.facts?.linked;
  const uploading = (state.uploading ?? []).length > 0;
  const folders = (state.installs ?? []).length;
  // Linked, and no game found: the one thing left to do is show Ravenpost where it is.
  const lost = linked && !uploading && folders === 0;
  const title = uploading ? t.status.uploading((state.uploading ?? []).join(", ")) : lost ? t.status.whereIsWow : linked ? t.status.caughtUp : t.status.notLinked;
  return (
    <section className="panel flex items-center gap-5 overflow-hidden px-6 py-5">
      {/* the hearth's glow behind the raven */}
      <div aria-hidden className="pointer-events-none absolute -top-16 -left-10 size-56 rounded-full bg-gold/10 blur-3xl" />
      <div className="relative shrink-0">
        <img src="/icon.png" alt="" width={72} height={72} className="size-[72px] rounded-2xl" />
        {uploading && <span aria-hidden className="spin-slow absolute -inset-1.5 rounded-[20px] border-2 border-transparent border-t-gold border-r-gold/50" />}
        {!uploading && linked && !lost && (
          <span aria-hidden className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full border-2 border-stone bg-ok text-night">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="relative min-w-0 flex-1">
        <h1 className="title text-[22px] leading-tight">{title}</h1>
        {lost ? (
          <p className="mt-1 max-w-xl text-dim">{t.status.whereIsWowWhy}</p>
        ) : linked ? (
          <p className="mt-1 text-dim">
            {state.lastSync ? t.status.lastUpload(ago(state.lastSync, locale, t.ago.never, now)) : t.status.never}
            <span className="text-faint"> · </span>
            {folders ? t.status.folders(folders) : <span className="text-blood">{t.status.noFolder}</span>}
          </p>
        ) : (
          <p className="mt-1 max-w-xl text-dim">{t.status.linkFirst}</p>
        )}
        {linked && !lost && !state.lastSync && <p className="mt-1 text-sm text-faint">{t.status.how}</p>}
      </div>
      {lost ? (
        <button type="button" className="btn btn-gold relative shrink-0" onClick={() => run(() => api.ChooseFolder())}>
          <FolderPlus className="size-4" aria-hidden />
          {t.status.addFolder}
        </button>
      ) : (
        <button type="button" className="btn btn-gold relative shrink-0" disabled={!linked || uploading} onClick={() => run(() => api.SyncNow())}>
          <RefreshCw className={`size-4 ${uploading ? "animate-spin" : ""}`} aria-hidden />
          {t.syncNow}
        </button>
      )}
    </section>
  );
}

/**
 * The addons' database: what the game told this computer's players of the
 * world, for every player of the addons, sent with no account or link once
 * they tick "Share what you see" in an addon.
 */
function SharingCard() {
  const { state, t, locale } = useApp();
  const now = useNow();
  const shares = state.sharing ?? [];
  const linked = !!state.facts?.linked;
  return (
    <article className="panel col-span-2 flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="title text-lg">{t.sharing.title}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-dim">{t.sharing.why}</p>
        </div>
        {linked && shares.length ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
            <Share2 className="size-3" strokeWidth={2.5} aria-hidden />
            {t.sharing.on}
          </span>
        ) : (
          <span className="tag shrink-0">{linked ? t.sharing.ready : t.sharing.off}</span>
        )}
      </div>
      {shares.length > 0 && (
        <ul className="flex flex-col divide-y divide-white/[0.05]">
          {shares.map((s) => (
            <ShareLine key={`${s.addon}|${s.install}|${s.account}`} share={s} now={now} locale={locale} linked={linked} />
          ))}
        </ul>
      )}
      <p className="max-w-2xl text-sm text-parchment">{linked ? (shares.length ? t.sharing.thanks : t.sharing.how) : shares.length ? t.sharing.signInToSend : t.sharing.how}</p>
      <p className="text-xs text-faint">{t.sharing.never}</p>
    </article>
  );
}

function ShareLine({ share: s, now, locale, linked }: { share: Share; now: number; locale: string; linked: boolean }) {
  const { t } = useApp();
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="font-semibold text-parchment">{s.addon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-faint">
        {s.account} · {s.install}
      </span>
      <span className="shrink-0 text-sm text-dim">{s.waiting ? t.sharing.toSend(s.seen, s.waiting, linked) : t.sharing.sent(s.seen)}</span>
      <span className="w-24 shrink-0 text-right text-xs text-faint">{s.at ? ago(s.at, locale, t.ago.never, now) : ""}</span>
    </li>
  );
}

/** The one Battle.net sign-in: the addons' database and Hearthtale at once (WoWLocker keeps its own link). */
function AccountCard() {
  const { state, t, api, run } = useApp();
  const link = state.facts;
  const p = link?.pairing;
  const waiting = p?.status === "waiting";
  const signedIn = !!link?.linked;
  const signOut = () => run(async () => {
    await api.Unlink("shared");
    await api.Unlink("hearthtale");
  });
  return (
    <article className="panel col-span-2 flex flex-wrap items-center gap-x-5 gap-y-3 p-5">
      <div className="min-w-0 flex-1">
        <h2 className="title text-lg">{t.account.title}</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-dim">{signedIn ? t.account.signedIn(link?.battletag || "Battle.net") : t.account.why}</p>
        {!signedIn && p && ["failed", "expired"].includes(p.status) && <p className="mt-1 text-sm text-blood">{t.account.failed}</p>}
      </div>
      {signedIn ? (
        <button type="button" className="btn btn-ghost" onClick={signOut}>
          <Unlink className="size-4" aria-hidden />
          {t.account.signOut}
        </button>
      ) : waiting ? (
        <div className="fade-in flex items-center gap-3 rounded-lg border border-gold/25 bg-black/30 px-3.5 py-2.5">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden />
          <span className="text-sm text-dim">{t.account.waiting}</span>
          <button type="button" className="text-sm text-gold-soft underline-offset-2 hover:underline" onClick={() => run(() => api.Open(p!.url))}>
            {t.sites.reopen}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-bnet" onClick={() => run(() => api.Link("shared"))}>
          <Link2 className="size-4" aria-hidden />
          {t.account.signIn}
        </button>
      )}
    </article>
  );
}

function SiteCards() {
  const { state } = useApp();
  return (state.sites ?? []).map((site) => <SiteCard key={site.id} site={site} />);
}

/** One site: linked as whom, linking now (the code to confirm), or a button to link it. */
function SiteCard({ site }: { site: SiteState }) {
  const { state, t, api, run } = useApp();
  const p = site.pairing;
  const waiting = p?.status === "waiting";
  return (
    <article className="panel flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="title text-lg">{site.name}</h2>
          <p className="mt-0.5 text-sm text-dim">{t.sites.why[site.id]}</p>
        </div>
        {site.linked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
            <Check className="size-3" strokeWidth={3} aria-hidden />
            {t.sites.linked}
          </span>
        ) : (
          <span className="tag shrink-0">{t.sites.notLinked}</span>
        )}
      </div>

      {waiting ? (
        <div className="fade-in rounded-lg border border-gold/25 bg-black/30 p-3.5">
          <p className="flex items-center gap-2 text-sm text-dim">
            <Loader2 className="size-3.5 animate-spin text-gold" aria-hidden />
            {t.sites.waiting}
          </p>
          <p className="mt-2 font-mono text-[26px] font-semibold tracking-[0.3em] text-gold select-text">{p.code}</p>
          <button type="button" className="mt-1 text-sm text-gold-soft underline-offset-2 hover:underline" onClick={() => run(() => api.Open(p.url))}>
            {t.sites.reopen}
          </button>
        </div>
      ) : site.linked ? (
        <p className="text-parchment">
          {t.sites.linked} <span className="font-semibold">{t.sites.as(site.battletag || "Battle.net")}</span>
        </p>
      ) : (
        p?.status === "expired" && <p className="text-sm text-blood">{t.sites.expired}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {site.linked ? (
          <>
            <button type="button" className="btn" onClick={() => run(() => api.Open(site.server))}>
              <ExternalLink className="size-4" aria-hidden />
              {t.sites.open}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => run(() => api.Unlink(site.id))}>
              <Unlink className="size-4" aria-hidden />
              {t.sites.unlink}
            </button>
          </>
        ) : site.id === "hearthtale" ? (
          state.facts?.linked ? (
            <button type="button" className="btn btn-bnet" onClick={() => run(() => api.Link("shared"))}>
              <Link2 className="size-4" aria-hidden />
              {t.account.again}
            </button>
          ) : (
            <span className="text-sm text-faint">{t.account.viaSignIn}</span>
          )
        ) : (
          !waiting && (
            <>
              <button type="button" className="btn btn-bnet" onClick={() => run(() => api.Link(site.id))}>
                <Link2 className="size-4" aria-hidden />
                {p?.status === "expired" ? t.sites.retry : t.sites.link}
              </button>
              <span className="truncate text-xs text-faint">{site.server.replace(/^https?:\/\//, "")}</span>
            </>
          )
        )}
      </div>
    </article>
  );
}

/** What Ravenpost did lately, the latest first: the proof it's working. */
function ActivityPanel() {
  const { state, t, locale } = useApp();
  const now = useNow();
  const items = (state.activity ?? []).slice(0, 12);
  const siteName: Record<string, string> = { ...Object.fromEntries((state.sites ?? []).map((s) => [s.id, s.name])), shared: t.activity.sharedSite };
  return (
    <section className="panel p-5" aria-labelledby="activity">
      <h2 id="activity" className="title text-base">
        {t.activity.title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-dim">{t.activity.empty}</p>
      ) : (
        <ol className="mt-2 divide-y divide-white/[0.05]">
          {items.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex items-center gap-3 py-2.5">
              <ActivityIcon kind={a.kind} />
              <span className="min-w-0 flex-1 truncate">{describe(t, a, siteName[a.service] ?? a.service)}</span>
              <span className="tag shrink-0">{siteName[a.service] ?? a.service}</span>
              <time dateTime={a.at} className="w-24 shrink-0 text-right text-xs text-faint">
                {ago(a.at, locale, t.ago.never, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  const cls = "size-4 shrink-0";
  if (kind === "sent") return <CheckCircle2 className={`${cls} text-ok`} aria-hidden />;
  if (kind === "shared") return <Share2 className={`${cls} text-ok`} aria-hidden />;
  if (kind === "refused") return <AlertTriangle className={`${cls} text-gold`} aria-hidden />;
  if (kind === "failed") return <XCircle className={`${cls} text-blood`} aria-hidden />;
  if (kind === "linked") return <Link2 className={`${cls} text-gold`} aria-hidden />;
  return <Unlink className={`${cls} text-faint`} aria-hidden />;
}
