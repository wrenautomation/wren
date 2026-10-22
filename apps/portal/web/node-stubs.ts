import type { Plugin } from "vite";

/**
 * Server code the app imports but never runs in the browser (a `createHash` in a core file) reads
 * a name off a Node module. The build stubs those modules and only a call would fail; Vite's dev
 * server throws on the read, at load. This stub does what the build does: each name is there and
 * throws only if called. The browser only: the Worker in `pnpm dev` keeps its own modules.
 * Storybook (../.storybook/main.ts) and the dev server (vite.config.ts) both use it.
 */
const NODE = "\0node-stub:";
export const nodeStubs: Plugin = {
  name: "node-stubs",
  enforce: "pre",
  applyToEnvironment: (env) => env.name === "client",
  resolveId: (id) => (id.startsWith("node:") ? NODE + id : null),
  async load(id) {
    if (!id.startsWith(NODE)) return null;
    const name = id.slice(NODE.length);
    const names = Object.keys(await import(name)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
    const stub = `() => { throw new Error("${name} is server-only: it can't run in the browser"); }`;
    return [
      `const no = ${stub};`,
      "export default new Proxy({}, { get: () => no });",
      ...names.filter((k) => k !== "default").map((k) => `export const ${k} = no;`),
    ].join("\n");
  },
};
