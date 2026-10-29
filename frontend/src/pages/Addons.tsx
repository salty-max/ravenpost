import { CheckCircle2, Circle, HardDrive, Puzzle } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/lib/app";

// The family's addons in the order the page lists the missing ones (Go's familyAddons).
const FAMILY = ["Hearthtale", "Lorekeeper's Codex", "Yonder", "Second Wind", "Keyring", "Palaver", "Mealbook", "Goodwill", "Yours Truly", "WoWLocker"];

/** Each game folder found, the family's addons installed in it, and which have saved their file. */
export function Addons() {
  const { state, t } = useApp();
  const installs = state.installs ?? [];
  const forever = installs.some((i) => i.flavour === "_forever_");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.addons.title} intro={t.addons.intro} />
      {installs.length === 0 && <p className="panel p-6 text-center text-dim">{t.addons.none}</p>}
      {installs.map((i) => {
        const have = new Set((i.addons ?? []).map((a) => a.name));
        const missing = FAMILY.filter((n) => !have.has(n));
        return (
          <section key={i.path} className="panel p-5">
            <h2 className="flex items-center gap-2">
              <HardDrive className="size-4 shrink-0 text-gold" aria-hidden />
              <span className="font-semibold text-gold">{i.label}</span>
              <span className="text-xs text-faint">{(i.addons ?? []).length}/{FAMILY.length}</span>
            </h2>
            {(i.addons ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-dim">{t.addons.empty}</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-white/[0.05]">
                {(i.addons ?? []).map((a) => (
                  <li key={a.folder} className="flex items-center gap-3 py-2">
                    <Puzzle className="size-4 shrink-0 text-faint" aria-hidden />
                    <span className="font-semibold text-parchment">{a.name}</span>
                    <span className="text-sm text-faint">{a.version ? t.addons.version(a.version) : t.addons.noVersion}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-sm text-dim">
                      {a.data ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : <Circle className="size-4 text-faint" aria-hidden />}
                      {a.data ? t.addons.saved : t.addons.notYet}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {missing.length > 0 && (i.addons ?? []).length > 0 && <p className="mt-3 text-xs text-faint">{t.addons.missing(missing.join(", "))}</p>}
          </section>
        );
      })}
      {installs.length > 0 && !forever && <p className="panel p-5 text-sm text-dim">{t.addons.foreverMissing}</p>}
      <p className="text-xs text-faint">{t.addons.hint}</p>
    </div>
  );
}
