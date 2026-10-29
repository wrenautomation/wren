/**
 * The portal's screens as JSON, for kestrel's ui layer (kestrel.json `layers.ui.dump`): areas in
 * order, each app (and the name it is exported as) and its pages, each page's template and record
 * or its own file, and `api`: each client path's first part → the Restate service. Vite loads the modules as the portal does, so a spread or a shared page list
 * reads right.
 */
import { Window } from "happy-dom";
import { createServer } from "vite";

// Some modules read the page at load (api.ts reads `location`): give them one. Every window
// field Node lacks goes on the global, as a browser has it.
const page = new Window({ url: "https://app.wrenautomation.com/" });
const own = page as unknown as Record<string, unknown>;
const names = new Set<string>();
for (let o: object | null = page; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
  for (const k of Object.getOwnPropertyNames(o)) names.add(k);
for (const k of ["window", "document", "location", "navigator", ...names]) {
  if (k !== "window" && k !== "navigator" && k in globalThis) continue;
  const v = own[k];
  const value = typeof v === "function" && !/^[A-Z]/.test(k) ? v.bind(page) : v;
  Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
}

const vite = await createServer({
  configFile: false,
  root: new URL("../web", import.meta.url).pathname,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const root = new URL("../../../", import.meta.url).pathname;
type Page = {
  id: string;
  label: string;
  about?: string;
  group?: string;
  hidden?: true;
  template?: string;
  record?: string;
  Page?: unknown;
};
type App = {
  id: string;
  name: string;
  blurb: string;
  parked?: true;
  menu?: true;
  requires?: { audience?: string };
  pages: Page[];
};
try {
  const { MODULES } = (await vite.ssrLoadModule("/src/modules/index.ts")) as { MODULES: App[] };
  const areas = await vite.ssrLoadModule("/src/areas.ts");
  // Every loaded source file's exports, so a page's component names the file it is drawn in.
  const fileOf = new Map<unknown, string>();
  const nameOf = new Map<unknown, string>();
  for (const m of vite.moduleGraph.idToModuleMap.values()) {
    if (!m.file?.startsWith(`${root}apps/portal/web/src/`) || !m.ssrModule) continue;
    for (const [k, v] of Object.entries(m.ssrModule)) {
      if (fileOf.has(v)) continue;
      fileOf.set(v, m.file.slice(root.length));
      nameOf.set(v, k);
    }
  }
  const template = fileOf.get((await vite.ssrLoadModule("/src/records.tsx")).TemplatePage);
  const { SERVICES } = (await vite.ssrLoadModule(`${root}apps/portal/src/services.ts`)) as {
    SERVICES: Record<string, { name: string }>;
  };
  const out = {
    areas: { team: areas.AREAS_TEAM, client: areas.AREAS_CLIENT },
    apps: MODULES.map((m) => ({
      id: m.id,
      name: m.name,
      blurb: m.blurb,
      file: fileOf.get(m),
      export: nameOf.get(m),
      ...(m.requires?.audience ? { audience: m.requires.audience } : {}),
      ...(m.parked ? { parked: true } : {}),
      ...(m.menu ? { menu: true } : {}),
      pages: m.pages.map((p) => ({
        id: p.id,
        label: p.label,
        ...(p.about ? { about: p.about } : {}),
        ...(p.group ? { group: p.group } : {}),
        ...(p.hidden ? { hidden: true } : {}),
        template: p.template ?? "hand",
        ...(p.record ? { record: p.record } : {}),
        file: p.Page ? fileOf.get(p.Page) : template,
      })),
    })),
    api: Object.fromEntries(Object.entries(SERVICES).map(([k, s]) => [k, s.name])),
  };
  // every repo file vite loaded, plus this script: kestrel reruns ui only when one changes
  const inputs = new Set([new URL(import.meta.url).pathname.slice(root.length)]);
  for (const m of vite.moduleGraph.idToModuleMap.values())
    if (m.file?.startsWith(root) && !m.file.includes("/node_modules/"))
      inputs.add(m.file.slice(root.length));
  process.stdout.write(`${JSON.stringify({ ...out, inputs: [...inputs].sort() }, null, 2)}\n`);
} finally {
  await vite.close();
}
