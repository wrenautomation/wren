import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
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

/**
 * onnxruntime's 26.9 MB wasm is over a Workers asset's 25 MiB, so the model's worker build drops
 * it and the app build ships it gzipped (6.6 MB) at /ort/<version>/ from our own origin. The
 * speech model's worker unzips it (src/dictation/model.worker.ts). Dev serves the same path.
 */
const ORT_WASM = "ort-wasm-simd-threaded.asyncify.wasm";
const noOrtWasm: Plugin = {
  name: "no-ort-wasm",
  apply: "build",
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle))
      if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name];
  },
};
function ortDir(): string {
  const transformers = createRequire(import.meta.url).resolve("@huggingface/transformers");
  const entry = createRequire(transformers).resolve("onnxruntime-web");
  return entry.slice(0, entry.lastIndexOf("/dist/"));
}
function ortWasm(): { path: string; gz: () => Buffer } {
  const dir = ortDir();
  const { version } = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as {
    version: string;
  };
  return {
    path: `ort/${version}/${ORT_WASM}.gz`,
    gz: () => gzipSync(readFileSync(`${dir}/dist/${ORT_WASM}`), { level: 9 }),
  };
}
const ownOrtWasm: Plugin = {
  name: "own-ort-wasm",
  generateBundle() {
    const w = ortWasm();
    this.emitFile({ type: "asset", fileName: w.path, source: w.gz() });
  },
  configureServer(server) {
    const w = ortWasm();
    let gz: Buffer | null = null;
    server.middlewares.use(`/${w.path}`, (_req, res) => {
      gz ??= w.gz();
      res.setHeader("content-type", "application/gzip");
      res.end(gz);
    });
  },
};

// Built into ../dist, which the Worker serves as its assets. `replay.html` is the session player,
// `book.html` a client's public booking page (`src/book.ts`).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), sonnerStyles, ownOrtWasm],
  // Dictation's speech model runs in a module worker (src/dictation/model.worker.ts).
  worker: { format: "es", plugins: () => [noOrtWasm] },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: `${import.meta.dirname}/index.html`,
        replay: `${import.meta.dirname}/replay.html`,
        book: `${import.meta.dirname}/book.html`,
      },
    },
  },
});
