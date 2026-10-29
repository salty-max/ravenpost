import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// A static page, nothing inline: vercel.json's CSP allows only the site's own
// styles and scripts (scripts/csp.ts checks the build).
export default defineConfig({
  site: "https://ravenpost-site.vercel.app",
  output: "static",
  build: { inlineStylesheets: "never" },
  vite: {
    plugins: [tailwindcss()],
    build: { assetsInlineLimit: 0 },
  },
});
