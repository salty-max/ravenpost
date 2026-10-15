import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app } from "./app";

// Local: the inbox on PORT (3003), uploads in .inbox/ (INBOX_DIR), the app's
// files from public/ (on Vercel, the build serves them).
const port = Number(process.env.PORT ?? 3003);
const PUBLIC = path.join(import.meta.dir, "..", "public");
const TYPES: Record<string, string> = { ".js": "text/javascript", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
Bun.serve({
  port,
  fetch(req) {
    const f = path.join(PUBLIC, path.normalize(new URL(req.url).pathname));
    if (f.startsWith(PUBLIC + path.sep) && existsSync(f) && TYPES[path.extname(f)])
      return new Response(readFileSync(f), { headers: { "content-type": TYPES[path.extname(f)] } });
    return app.fetch(req);
  },
});
console.log(`inbox on http://localhost:${port}`);
