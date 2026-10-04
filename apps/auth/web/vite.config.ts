import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built into ../dist/web, which the Worker serves as its assets.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/web", emptyOutDir: true },
});
