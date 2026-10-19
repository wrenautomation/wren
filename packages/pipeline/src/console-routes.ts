import type { Need, RouteApps } from "@wren/core/access";

/**
 * PipelineConsole's handlers (`console.ts`) and what each needs: the workspace's offers, shape,
 * journeys, deals and numbers, read by whoever may see that workspace (Wren's, or a client's);
 * every change is an act in Opportunities. The edge Worker opens only these and refuses the
 * writes on the demo. Type imports only, so the Worker bundles it alone.
 */
export const PIPELINE_CONSOLE_ROUTES = {
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  offersSync: "act",
  shapeVersion: "act",
  shapeDiff: "read",
  shapeImport: "act",
  journeysOpen: "act",
  journeysMove: "act",
  journeysDrop: "act",
  dealsSign: "act",
  termsAdd: "act",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): records check each type; the rest are Opportunities. */
export const PIPELINE_CONSOLE_APPS = {
  "*": "deals",
  recordsTypes: null,
  recordsList: null,
  recordsGet: null,
  recordsExport: null,
  recordsStats: null,
} as const satisfies RouteApps<typeof PIPELINE_CONSOLE_ROUTES>;
export type PipelineConsoleRoute = keyof typeof PIPELINE_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const PIPELINE_CONSOLE_WRITES: readonly PipelineConsoleRoute[] = [
  "offersSync",
  "shapeVersion",
  "shapeImport",
  "journeysOpen",
  "journeysMove",
  "journeysDrop",
  "dealsSign",
  "termsAdd",
];
