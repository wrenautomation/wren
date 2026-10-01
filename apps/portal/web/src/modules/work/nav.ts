/** Links between the work's pages, inside whichever app shows them. */
import { href, type Params } from "../../route.js";

export const WORK = "work";

/** The app this page is open in: the work's own, or a product's that shows its plan. */
export const appHere = () => location.pathname.split("/")[1] || WORK;

export const at = (page: string, params?: Params) => href(`/${appHere()}/${page}`, params);
