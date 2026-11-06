import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app } from "./app";

// Local: the inbox on PORT (3003), uploads in .inbox/ (INBOX_DIR), the app's
// files from public/ (on Vercel, the build serves them and scripts/vercel-build.sh
// routes /stats/next to the phone app, as the rewrite below does here).
const port = Number(process.env.PORT ?? 3003);
const PUBLIC = path.join(import.meta.dir, "..", "public");
const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
};
const file = (f: string, headers: Record<string, string> = {}) => new Response(readFileSync(f), { headers: { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", ...headers } });
Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    // (the phone app: its page at /stats/next, its service worker beside it)
    if (url.pathname === "/stats/next/sw.js" && existsSync(path.join(PUBLIC, "app", "sw.js"))) return file(path.join(PUBLIC, "app", "sw.js"), { "Service-Worker-Allowed": "/stats/next/", "Cache-Control": "no-cache" });
    if (/^\/stats\/next(\/.*)?$/.test(url.pathname) && existsSync(path.join(PUBLIC, "app", "index.html"))) return file(path.join(PUBLIC, "app", "index.html"));
    const f = path.join(PUBLIC, path.normalize(url.pathname));
    if (f.startsWith(PUBLIC + path.sep) && existsSync(f) && TYPES[path.extname(f)]) return file(f);
    return app.fetch(req);
  },
});
console.log(`inbox on http://localhost:${port}`);
