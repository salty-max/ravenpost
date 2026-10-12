import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/app";

/** An on/off switch (role switch): what a checkbox is, in a window. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40 ${
        on ? "border-gold-soft bg-gold-soft/80" : "border-edge bg-stone-3"
      }`}
    >
      <span className={`inline-block size-3.5 rounded-full shadow transition-transform ${on ? "translate-x-[18px] bg-night" : "translate-x-[3px] bg-dim"}`} />
    </button>
  );
}

/** A page's title and what it is for. */
export function PageHeader({ title, intro, action }: { title: string; intro?: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="title text-2xl">{title}</h1>
        {intro && <p className="mt-1.5 max-w-2xl text-dim">{intro}</p>}
      </div>
      {action}
    </header>
  );
}

/** The toasts, bottom right: what an upload brought, what went wrong. */
export function Toasts() {
  const { toasts } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-[22rem] flex-col gap-2">
      {toasts.map((x) => (
        <div
          key={x.id}
          className={`panel fade-in flex items-start gap-2.5 px-3.5 py-3 ${x.tone === "error" ? "border-blood/50" : "border-ok/40"}`}
        >
          {x.tone === "error" ? <XCircle className="mt-px size-4 shrink-0 text-blood" aria-hidden /> : <CheckCircle2 className="mt-px size-4 shrink-0 text-ok" aria-hidden />}
          <span className="select-text">{x.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Now, every 30 s: for "2 minutes ago" to stay true. */
export function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
