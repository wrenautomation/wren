/** Links between Reactivation's pages. */
import { go, href, type Params } from "../../route.js";

/** The place its pages live in (`../places.ts`). */
export const REACTIVATION = "campaigns";

export const at = (page: string, params?: Params) => href(`/${REACTIVATION}/${page}`, params);

/** Change some of this page's params, keeping the rest. */
export const goto = (page: string, params: Params, keep?: URLSearchParams) =>
  go(`/${REACTIVATION}/${page}`, params, keep);
