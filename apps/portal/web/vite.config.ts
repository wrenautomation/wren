import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Sonner adds its CSS as a <style> at load, which the CSP's style-src refuses. The same CSS comes
 * in the stylesheet (`@wren/ui` tailwind.css), so the build stops the insert, and fails if it can't.
 */
const INSERT = "function __insertCSS(code) {";
const sonnerStyles: Plugin = {
  name: "sonner-styles",
  apply: "build",
  transform(code, id) {
    if (!/\/sonner\/dist\/index\.m?js$/.test(id)) return;
    if (!code.includes(INSERT)) this.error("sonner no longer has __insertCSS: check its <style>");
    return code.replace(INSERT, `${INSERT} return;`);
  },
};

// Built into ../dist, which the Worker serves as its assets. `replay.html` is the session player.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), sonnerStyles],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: `${import.meta.dirname}/index.html`,
        replay: `${import.meta.dirname}/replay.html`,
      },
    },
  },
});
