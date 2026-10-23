/**
 * Builds `wren-engine.js` and `wren-engine.css` for claude.ai artifacts: one script, React inside,
 * `window.Wren` outside. `pnpm --filter @wren/ui engine <out dir>`.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The page has no Node: React's build checks need the mode baked in.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: new URL("./entry.ts", import.meta.url).pathname,
      name: "Wren",
      formats: ["iife"],
      fileName: () => "wren-engine.js",
      cssFileName: "wren-engine",
    },
    cssCodeSplit: false,
    minify: true,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
