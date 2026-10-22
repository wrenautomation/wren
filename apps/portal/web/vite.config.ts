import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rollup } from "vite";
import { BUILD_FILE, BUILD_META } from "../src/build.js";
import { nodeStubs } from "./node-stubs.js";

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
 * The database client never reaches the browser: postgres.js needs Node's Buffer, and the app dies
 * on load (a blank page). A web import of a core file that takes a value from the `@wren/db` root
 * pulls it in; import from a db-free subpath (`@wren/db/isolation`) or split the file.
 */
const serverOnly: Plugin = {
  name: "server-only",
  apply: "build",
  transform(_, id) {
    if (
      /\/node_modules\/(\.pnpm\/postgres@[^/]+\/node_modules\/)?postgres\//.test(id) ||
      /\/packages\/db\/src\/index\.ts$/.test(id)
    )
      this.error(`${id} is server-only, yet the portal web imports it`);
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

/**
 * The build's id (wa-ovo, ../src/build.ts): a hash of the files it emits, whose names carry their
 * own content hashes, so it moves only when the app does. Written into each page as a meta tag the
 * tab sends on every call, and as build.json, which the Worker reads to tell an older tab to reload.
 */
function buildId(): Plugin {
  let id: string | null = null;
  const own = BUILD_FILE.slice(1);
  const idOf = (bundle: Rollup.OutputBundle) => {
    id ??= createHash("sha256")
      .update(
        Object.keys(bundle)
          .filter((f) => !f.endsWith(".html") && f !== own)
          .sort()
          .join("\n"),
      )
      .digest("hex")
      .slice(0, 16);
    return id;
  };
  return {
    name: "build-id",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (_html, ctx) =>
        ctx.bundle
          ? [
              {
                tag: "meta",
                attrs: { name: BUILD_META, content: idOf(ctx.bundle) },
                injectTo: "head-prepend",
              },
            ]
          : undefined,
    },
    generateBundle(_, bundle) {
      this.emitFile({ type: "asset", fileName: own, source: JSON.stringify({ id: idOf(bundle) }) });
    },
  };
}

/**
 * `pnpm dev` (designs/2026-10-21-dev-loop.md): the Worker runs inside Vite, the app hot-reloads,
 * and the API reads prod through Restate as the operator WREN_DEV_EMAIL. The token comes from SSM
 * into this process's env (scripts/secrets.mjs run), never a file. Writes stay off unless
 * WREN_DEV_WRITES=1 (../src/dev.ts).
 */
const DEV_VARS = {
  WREN_DEV: "1",
  WREN_DEV_WRITES: process.env.WREN_DEV_WRITES ?? "",
  // The team operator; another with WREN_DEV_EMAIL.
  WREN_DEV_EMAIL: process.env.WREN_DEV_EMAIL ?? "william@wrenautomation.com",
  // Local is no client's host.
  APP_HOST: "",
  RESTATE_INGRESS_URL: process.env.WREN_DEV_INGRESS ?? "https://restate.wrenautomation.com",
  RESTATE_AUTH_TOKEN: process.env.RESTATE_AUTH_TOKEN ?? "",
};
const worker = () =>
  cloudflare({
    configPath: `${import.meta.dirname}/../wrangler.toml`,
    config: (c) => {
      c.vars = { ...c.vars, ...DEV_VARS };
    },
    persistState: false,
  });

// Built into ../dist, which the Worker serves as its assets. `replay.html` is the session player,
// `book.html` a client's public booking page (`src/book.ts`).
export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  plugins: [
    react(),
    tailwindcss(),
    sonnerStyles,
    ownOrtWasm,
    serverOnly,
    buildId(),
    ...(command === "serve" ? [nodeStubs, worker()] : []),
  ],
  // The dev mark (src/dev-banner.tsx): the dev server only.
  ...(command === "serve"
    ? { define: { __WREN_DEV__: JSON.stringify({ writes: DEV_VARS.WREN_DEV_WRITES === "1" }) } }
    : {}),
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
}));
