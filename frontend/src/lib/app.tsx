import { Events } from "@wailsio/runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Ravenpost from "../../bindings/github.com/salty-max/ravenpost/ravenpost";
import type { State } from "../../bindings/github.com/salty-max/ravenpost/models";
import { stringsFor, type Strings } from "@/lib/i18n";
import { describe } from "@/lib/activity";

export type { State };
export type Toast = { id: number; text: string; tone: "ok" | "error" };

type Ctx = {
  state: State;
  t: Strings;
  locale: string;
  mac: boolean;
  /** Runs one of the app's actions; an error becomes a toast. */
  run: (action: () => Promise<unknown>) => Promise<void>;
  api: typeof Ravenpost;
  toasts: Toast[];
  say: (text: string, tone?: Toast["tone"]) => void;
};

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}

// While developing in a plain browser (vite, ?mock): a made-up state, no app behind it.
const MOCK = import.meta.env.DEV && new URLSearchParams(location.search).has("mock");

/**
 * The app's state, as Go sends it: once at the start, then whole on every
 * change (the "state" event). A new upload while the window is open says what
 * it brought, in a toast.
 */
export function AppProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [api, setApi] = useState<typeof Ravenpost>(Ravenpost);
  const lastSync = useRef<string | undefined>(undefined);

  const say = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    if (MOCK) {
      void import("@/mock").then((m) => {
        setApi(() => m.mockApi(setState) as unknown as typeof Ravenpost);
        setState(m.mockState());
      });
      return;
    }
    void Ravenpost.State().then(setState);
    return Events.On("state", (e) => setState(e.data));
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!state) return null;
    const { t, locale } = stringsFor(state.language);
    return {
      state,
      t,
      locale,
      mac: navigator.userAgent.includes("Mac"),
      api,
      toasts,
      say,
      run: async (action) => {
        try {
          await action();
        } catch (e) {
          say(e instanceof Error ? e.message : String(e), "error");
        }
      },
    };
  }, [state, api, toasts, say]);

  // A new upload: what it brought (the journal's newest lines), for a few seconds.
  useEffect(() => {
    if (!state || !value) return;
    const prev = lastSync.current;
    lastSync.current = state.lastSync ?? "";
    if (prev === undefined || !state.lastSync || state.lastSync === prev) return;
    const since = prev ? Date.parse(prev) : 0;
    const siteName = Object.fromEntries((state.sites ?? []).map((s) => [s.id, s.name]));
    const sent = (state.activity ?? []).filter((a) => a.kind === "sent" && Date.parse(a.at) > since);
    if (sent.length) say(sent.map((a) => describe(value.t, a, siteName[a.service] ?? a.service)).join(" · "));
  }, [state, value, say]);

  return value ? <AppContext.Provider value={value}>{children}</AppContext.Provider> : <>{fallback}</>;
}
