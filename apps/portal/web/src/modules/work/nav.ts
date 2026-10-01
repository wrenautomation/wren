/** Links between the work's pages. */
import { href, type Params } from "../../route.js";

export const WORK = "work";

export const at = (page: string, params?: Params) => href(`/${WORK}/${page}`, params);
