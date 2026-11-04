/** Links between the work's pages, each in its place (`../places.ts`). */
import { href, type Params } from "../../route.js";

/** The place each work page lives in. */
const PLACE: Readonly<Record<string, string>> = {
  overview: "map",
  plan: "map",
  updates: "map",
  results: "map",
  "needs-you": "inbox",
  deliverables: "inbox",
  welcome: "inbox",
  paperwork: "office",
  contract: "office",
};

/** A work page's address: `workAt("plan/3")` → `/map/plan/3`. */
export const workAt = (page: string) => `/${PLACE[page.split("/")[0] ?? ""] ?? "map"}/${page}`;

export const at = (page: string, params?: Params) => href(workAt(page), params);
