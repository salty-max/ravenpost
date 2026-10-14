import { app } from "./app";

// Local: the inbox on PORT (3003), uploads in .inbox/ (INBOX_DIR).
const port = Number(process.env.PORT ?? 3003);
Bun.serve({ port, fetch: app.fetch });
console.log(`inbox on http://localhost:${port}`);
