/** Links between the work's pages, each in its place (`../places.ts`). */
import { planPath } from "@wren/delivery/routes";
import { href, type Params } from "../../route.js";

/** A work page's address: `workAt("plan/3")` → `/project/plan/3`. */
export const workAt = planPath;

export const at = (page: string, params?: Params) => href(workAt(page), params);
