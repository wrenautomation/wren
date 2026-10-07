/**
 * Drafts finished in place (designs/2026-10-06-content-desk.md, 3 and 6): each page declares where
 * its rows hold a draft and what sends it, and the detail draws it as `@wren/ui`'s draft box:
 * typed and saved there, Ask Claude under it, the turns above, Undo beside the newest change.
 * While Claude works the detail reads again every few seconds.
 */
import type { DraftTurn } from "@wren/core/ask";
import type { DraftRecordView } from "@wren/core/draft-record";
import type { Row } from "@wren/core/records/serve";
import type { Action, MessageKind, RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { DraftVersions } from "./versions.js";

const POLL_MS = 4000;

/** The box's actions, ids the records list: save, ask and undo, run from inside the detail only. */
export const DRAFT_SET = "marketing.draftSet";
export const DRAFT_ASK = "marketing.draftAsk";
export const DRAFT_UNDO = "marketing.draftUndo";
export const DRAFT_BOX = [DRAFT_SET, DRAFT_ASK, DRAFT_UNDO];

/**
 * Save, Ask Claude and Undo on one page's drafts. `handler` names the page's kind: the Inbox's ids
 * carry theirs (`inbox`), a page's own don't (`post`, `comment`, `thread`).
 */
export const draftActions = (handler: string, when: NonNullable<Action["when"]>): Action[] => [
  { id: DRAFT_SET, label: "Save", handler: `marketing/${handler}Set`, inline: true, when },
  { id: DRAFT_ASK, label: "Ask Claude", handler: `marketing/${handler}Ask`, inline: true, when },
  { id: DRAFT_UNDO, label: "Undo", handler: `marketing/${handler}Undo`, inline: true, when },
];

/** Where a page's rows hold their draft, and the head action that sends it (⌘Enter). */
export interface DraftOf {
  field: string;
  label: string;
  send?: string;
  /** How it looks where it goes, from the record's detail. */
  preview?: (detail: unknown) => MessageKind | null;
}

/**
 * A page's extras with its draft box: `of` names the draft per row (null: this row holds none).
 * The turns are the detail's `ask` (`draftTurns`).
 */
export const withDraft =
  (
    of: DraftOf | ((row: Row) => DraftOf | null),
    extras?: ListPage["extras"],
  ): NonNullable<ListPage["extras"]> =>
  (detail, at) => {
    const base: RecordExtras = extras ? extras(detail, at) : {};
    const d = typeof of === "function" ? of(at.row) : of;
    if (!d) return base;
    const turns = (detail as { ask?: DraftTurn[] } | null)?.ask ?? [];
    const record = (detail as { record?: DraftRecordView | null } | null)?.record;
    const text = at.row[d.field];
    return {
      ...base,
      ...(record?.versions.length
        ? {
            sections: [
              ...(base.sections ?? []),
              ["Versions", <DraftVersions key={record.item} record={record} />],
            ],
          }
        : {}),
      draft: {
        field: d.field,
        label: d.label,
        text: typeof text === "string" ? text : null,
        turns,
        preview: d.preview?.(detail) ?? null,
        save: DRAFT_SET,
        ask: DRAFT_ASK,
        undo: DRAFT_UNDO,
        send: d.send,
      },
      ...(turns.some((t) => t.state === "thinking") ? { poll: POLL_MS } : {}),
    };
  };
