/** The data layer (designs/2026-10-15-one-write-path.md, "The data layer"). */
export { focusManager, onlineManager } from "@tanstack/react-query";
export { listChanged } from "./delta.js";
export { EDITS, Edits } from "./edits.js";
export {
  dropLocalCopy,
  indexedStore,
  type KeyValue,
  type LocalCopy,
  startLocalCopy,
  tellTabsLanded,
} from "./local.js";
export {
  cachedOf,
  FOCUS_STALE_MS,
  keyOf,
  type Load,
  nameScope,
  type Patch,
  patchedSince,
  QUERIES,
  readCached,
  readTogether,
  refreshAll,
  stampOf,
  useLoad,
  writeThrough,
} from "./query.js";
export {
  indicatorOf,
  type SendLine,
  SendStatus,
  sendLineOf,
  useWritesState,
  WritesIndicator,
} from "./status.js";
export {
  type Edit,
  EditConflict,
  type EditConflictState,
  type EditOptions,
  KeptConflict,
  UnsavedMark,
  useEdit,
} from "./use-edit.js";
