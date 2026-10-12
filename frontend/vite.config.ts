import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The window's pages. In the app, Wails serves frontend/dist; while developing,
// FRONTEND_DEVSERVER_URL=http://127.0.0.1:9245 points it at this server instead.
export default defineConfig({
  server: { host: "127.0.0.1", port: Number(process.env.WAILS_VITE_PORT) || 9245, strictPort: true },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [react(), tailwindcss(), wails("./bindings")],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
