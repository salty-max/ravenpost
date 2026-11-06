import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The deploy's shape (scripts/vercel-build.sh), run into a scratch folder with a
 * stand-in for the phone app: /stats/next is the app, its service worker is
 * allowed that scope, the old /stats still goes to the function, and a deploy
 * without the built app refuses.
 */
const root = path.join(import.meta.dir, "..");
const run = (env: Record<string, string>) => Bun.spawnSync(["bash", "scripts/vercel-build.sh"], { cwd: root, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
type Route = { src?: string; dest?: string; handle?: string; headers?: Record<string, string>; continue?: boolean };
const resolve = (routes: Route[], url: string) => {
  const headers: Record<string, string> = {};
  for (const r of routes) {
    if (r.handle) continue;
    if (!new RegExp(r.src!).test(url)) continue;
    Object.assign(headers, r.headers);
    if (!r.continue) return { dest: r.dest ?? "(next)", headers };
  }
  return { dest: "(none)", headers };
};

describe("vercel build", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "vercel-out-"));
  const app = path.join(scratch, "app");
  mkdirSync(path.join(app, "assets"), { recursive: true });
  writeFileSync(path.join(app, "index.html"), "<!doctype html><title>Watchtower</title>");
  writeFileSync(path.join(app, "sw.js"), "// sw");
  const out = path.join(scratch, "output");

  test("the phone app is served at /stats/next, its worker may claim that scope, the old page is untouched", () => {
    const r = run({ OUT: out, APP: app });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const config = JSON.parse(readFileSync(path.join(out, "config.json"), "utf8")) as { routes: Route[] };
    for (const p of ["/stats/next", "/stats/next/", "/stats/next/anything"]) expect(resolve(config.routes, p).dest, p).toBe("/app/index.html");
    const sw = resolve(config.routes, "/stats/next/sw.js");
    expect(sw.dest).toBe("/app/sw.js");
    expect(sw.headers["Service-Worker-Allowed"]).toBe("/stats/next/");
    expect(resolve(config.routes, "/stats").dest).toBe("/api");
    expect(resolve(config.routes, "/api/owner/summary").dest).toBe("/api");
    expect(resolve(config.routes, "/sw.js").headers["Service-Worker-Allowed"]).toBe("/");
    expect(resolve(config.routes, "/app/assets/x.js").headers["Cache-Control"]).toContain("immutable");
    expect(readFileSync(path.join(out, "static", "app", "index.html"), "utf8")).toContain("Watchtower");
  }, 60_000);

  test("without the built app the build refuses and says what to run (the sync in Watchtower)", () => {
    const r = run({ OUT: path.join(scratch, "none"), APP: path.join(scratch, "missing") });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("ui-sync.ts");
  });

  test("the manifest names it Watchtower and starts inside the scope its worker has", () => {
    const m = JSON.parse(readFileSync(path.join(root, "public", "app", "manifest.webmanifest"), "utf8"));
    expect(m.name).toBe("Watchtower");
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.scope).toBe("/stats/next/");
  });
});
