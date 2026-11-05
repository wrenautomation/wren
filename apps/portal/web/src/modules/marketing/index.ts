/**
 * Marketing's pages and actions. `MARKETING_PAGES` is the one list; the Content and Outbound
 * products take pages from it (designs/2026-11-04-portal-places.md), a client's Marketing
 * (`clientMarketing`) keeps its own. Records and templates only; the console serves them.
 */

export { DM_DRAFT, INVITE_DRAFT } from "./approval.js";
export { DM_ACTIONS, DM_CANCEL } from "./dm.js";
export { ENGAGE_ACTIONS, ENGAGE_DRAFT } from "./engage.js";
export { clientMarketing, content } from "./modules.js";
export { CONVERSATION_TOP, MARKETING_PAGES } from "./pages.js";
export { ACCOUNT_ACTIONS, CONNECT_ACTIONS, INVITE_ACTIONS } from "./social.js";
