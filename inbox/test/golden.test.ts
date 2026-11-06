import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dashboard } from "../src/dashboard";
import { dashboardOptions, history, NOW } from "./fixtures/dashboard";

/**
 * The old page, byte for byte. The numbers moved out of dashboard.ts
 * (numbers.ts) must change nothing it draws: its output for fixed data and a
 * fixed clock is kept in test/golden/ and compared whole. To accept a change
 * the page is meant to make: `UPDATE_GOLDEN=1 bun test test/golden.test.ts`.
 */
const dir = path.join(import.meta.dir, "golden");
beforeAll(() => setSystemTime(new Date(NOW)));
afterAll(() => setSystemTime());

function golden(name: string, html: string) {
  const file = path.join(dir, `${name}.html`);
  if (process.env.UPDATE_GOLDEN || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, html);
  }
  const want = readFileSync(file, "utf8");
  // (a failure names the first line that differs, the page being one long file)
  if (html !== want) {
    const a = html.split("\n"), b = want.split("\n");
    const i = a.findIndex((l, k) => l !== b[k]);
    throw new Error(`${name}: line ${i + 1} differs\n  now:  ${a[i]?.slice(0, 300)}\n  want: ${b[i]?.slice(0, 300)}`);
  }
  expect(createHash("sha256").update(html).digest("hex")).toBe(createHash("sha256").update(want).digest("hex"));
}

test("a full day's page is the same", () => {
  golden("full", dashboard(history, dashboardOptions));
});

test("an empty history's page is the same", () => {
  golden("empty", dashboard({ days: {} }, { now: NOW }));
});
