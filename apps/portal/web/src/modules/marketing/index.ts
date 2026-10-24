/**
 * Marketing's pages (designs/2026-10-05-marketing-app.md): content, ads, search, texts and site
 * visits as one funnel. `MARKETING_PAGES` is the one list; Wren's team apps (Content, Engage,
 * Outbound, Ads, Analytics) each take pages from it (designs/2026-10-19-portal-reshape.md), and a
 * client's Marketing (`clientMarketing`) keeps its own. Records and templates only; the console
 * serves them.
 */

export { DM_DRAFT, INVITE_DRAFT, THREAD_DRAFT } from "./approval.js";
export { DM_ACTIONS, DM_CANCEL } from "./dm.js";
export { ENGAGE_ACTIONS, ENGAGE_DRAFT } from "./engage.js";
export { ads, clientMarketing, content } from "./modules.js";
export {
  APPROVAL_PAGE,
  CONVERSATION_TOP,
  DONE_PAGE,
  INBOX_PAGE,
  MARKETING_PAGES,
  SITE_PAGES,
} from "./pages.js";
export { PLACE_ACTIONS } from "./places.js";
export { ACCOUNT_ACTIONS, CONNECT_ACTIONS, INVITE_ACTIONS } from "./social.js";
export { THREAD_ACTIONS } from "./threads.js";
