import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built into ../dist, which the Worker serves as its assets.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
});
