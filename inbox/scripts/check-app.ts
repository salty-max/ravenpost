import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The inbox's copies of what Watchtower builds (public/app, the phone app, and
 * src/owner-schema.ts) are stamped by `bun scripts/ui-sync.ts` in the Watchtower
 * repository: they are never edited here. This holds the files to the stamp
 * (public/app/STAMP.json) without that repository. Whether the stamp is the
 * latest of Watchtower's sources is `ui-sync.ts --check` there.
 */
const root = path.join(import.meta.dir, "..");
const app = path.join(root, "public", "app");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const walk = (d: string, base = d): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]));

const bad: string[] = [];
if (!existsSync(path.join(app, "STAMP.json"))) bad.push("public/app/STAMP.json is missing");
else {
  const stamp = JSON.parse(readFileSync(path.join(app, "STAMP.json"), "utf8")) as { schema: string; files: Record<string, string> };
  const have = walk(app).filter((f) => f !== "STAMP.json");
  for (const f of have) if (stamp.files[f] !== sha(readFileSync(path.join(app, f)))) bad.push(`public/app/${f} is not the stamped file`);
  for (const f of Object.keys(stamp.files)) if (!have.includes(f)) bad.push(`public/app/${f} is missing`);
  const schema = path.join(root, "src", "owner-schema.ts");
  if (!existsSync(schema) || sha(readFileSync(schema)) !== stamp.schema) bad.push("src/owner-schema.ts is not the stamped file");
}
if (bad.length) {
  console.error(`check-app: the stamped copies were edited here (or half synced):\n- ${bad.join("\n- ")}\nRun 'bun scripts/ui-sync.ts' in the watchtower repository and commit its result.`);
  process.exit(1);
}
console.log("check-app: the stamped copies match their stamp");
