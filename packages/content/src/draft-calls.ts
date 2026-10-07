/**
 * A draft's handlers and the input key naming it: what a login limited to a channel may call on
 * a draft it may act on (`calls` in `@wren/core/records`). Its own file: `records.ts` re-exports
 * the social records, which use it, so it can't live there without a load-order cycle.
 */
export const DRAFT_CALLS = {
  "ContentDesk/approve": "ids",
  "ContentDesk/reject": "ids",
  "ContentDesk/redraft": "draftId",
  "ContentDesk/fields": "draftId",
  "ContentDesk/funnel": "draftId",
  "ContentDesk/attach": "draftId",
  "DraftAsk/set": "id",
  "DraftAsk/ask": "id",
  "DraftAsk/undo": "id",
} as const;
