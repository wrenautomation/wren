/** Links between Reactivation's pages. */
import { go, href, type Params } from "../../route.js";

export const REACTIVATION = "reactivation";

export const at = (page: string, params?: Params) => href(`/${REACTIVATION}/${page}`, params);

/** Change some of this page's params, keeping the rest. */
export const goto = (page: string, params: Params, keep?: URLSearchParams) =>
  go(`/${REACTIVATION}/${page}`, params, keep);
