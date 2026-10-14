import { getRequestListener } from "@hono/node-server";
import { app } from "./app";

// Vercel entry: the inbox as one Node.js function (bundled by scripts/vercel-build.sh).
export default getRequestListener(app.fetch);
