/**
 * The List and Record templates (console standard): a record type's rows and one record, drawn
 * from what the server's `recordsTypes` says, never per page. The address is the state: the
 * view, filters, search, sort, columns, page and open record each ride in it.
 */

export type { Load } from "./data/query.js";
export { useLoad } from "./data/query.js";
export { SearchBox, ViewTabs } from "./list-bar.js";
export {
  columnsOf,
  dockedOf,
  fitColumns,
  fitOf,
  ListSkeleton,
  ROOT,
  shownColumns,
  titleLeast,
  widthsOf,
} from "./records-columns.js";
export {
  askOf,
  Bulk,
  facetsOf,
  NotHere,
  pageAskOf,
  prefetchList,
  RecordList,
  TierLabel,
} from "./records-list.js";
export { Quiet, RecordBody, RecordPage } from "./records-page.js";
export type { PeekWire } from "./records-panel.js";
export { Kbd, Panel } from "./records-panel.js";
export { swipesOf, withReply } from "./records-swipes.js";
export type {
  ActPatch,
  EntryKeep,
  Late,
  Needs,
  Place,
  RecordAct,
  RecordActs,
  RecordExtras,
  RecordSource,
  RecordsApi,
  RecordTemplateProps,
  RowReplyBox,
  ShopSections,
} from "./records-types.js";
export {
  actionKeys,
  actsOf,
  cap,
  emptyOf,
  keyed,
  pressAct,
  shownVersion,
  startOf,
  subtitleCue,
  subtitleOf,
  textOf,
  tiersOf,
  titleOf,
  typing,
  useTypes,
  versionIn,
  waitsOn,
  walkKey,
  walkTo,
} from "./records-types.js";
