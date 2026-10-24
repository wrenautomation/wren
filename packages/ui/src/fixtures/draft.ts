/** Fixtures for `draft.tsx`: a draft a record holds, its turns, its actions and fake calls. */
import type { Action, Call } from "../action.js";
import { EDITS } from "../data/edits.js";
import type { DraftTurnLine, RecordDraft } from "../draft.js";
import { writeEntry } from "../save/journal.js";
import { answer, fails, pending } from "./load.js";
import { WORST } from "./worst.js";

/** The draft's inline actions, as the record lists them for this viewer. */
export const DRAFT_ACTIONS: Action[] = [
  { id: "save", label: "Save", handler: "draft/save" },
  { id: "ask", label: "Ask Claude", handler: "draft/ask" },
  { id: "undo", label: "Undo", handler: "draft/undo" },
  { id: "send", label: "Send", icon: "send", handler: "draft/send" },
];

export const DRAFT_TURNS: DraftTurnLine[] = [
  {
    id: "t1",
    command: "draft-ask",
    by: "Ada Example",
    message: "Make it shorter.",
    at: "2026-10-16T14:05:00Z",
    state: "done",
    reply: "Cut it to two sentences.",
    draft: "Hi Sam, quick question about your Q4 plan. Open to a short call this week?",
    error: null,
  },
  {
    id: "t2",
    command: "draft-set",
    by: "Ben Example",
    message: null,
    at: "2026-10-16T15:20:00Z",
    state: "done",
    reply: null,
    draft: null,
    error: null,
  },
];

const TEXT = "Hi Sam, quick question about your Q4 plan. Open to a short call this week?";

/** A draft the viewer can edit, ask Claude about and undo, previewed as an email. */
export const DRAFT: RecordDraft = {
  field: "body",
  label: "Draft",
  text: TEXT,
  turns: DRAFT_TURNS,
  preview: { kind: "email", from: "Ada Example <ada@example.com>", subject: "Quick question" },
  save: "save",
  ask: "ask",
  undo: "undo",
  send: "send",
};

/** No words yet, no turns. */
export const DRAFT_EMPTY: RecordDraft = { ...DRAFT, text: null, turns: [], preview: null };

/** A draft that only reads: no save action applies. */
export const DRAFT_READ_ONLY: RecordDraft = { ...DRAFT, save: "none" };

/** Long words, a long label, a thinking turn and a failed one, and a post preview. */
export const DRAFT_WORST: RecordDraft = {
  ...DRAFT,
  label: WORST.longLabel,
  text: `${WORST.longText}\n${WORST.nonLatin}\n${WORST.emoji}\n${WORST.url}`,
  preview: { kind: "post", site: "LinkedIn", max: 3000, feed: { laptop: 3, phone: 5 } },
  turns: [
    ...DRAFT_TURNS,
    {
      id: "t3",
      command: "draft-ask",
      by: WORST.longName,
      message: WORST.longText,
      at: "2026-10-16T16:00:00Z",
      state: "thinking",
      reply: null,
      draft: null,
      error: null,
    },
    {
      id: "t4",
      command: "draft-ask",
      by: WORST.email,
      message: WORST.rtl,
      at: "2026-10-16T16:30:00Z",
      state: "failed",
      reply: WORST.nonLatin,
      draft: WORST.longText,
      error: WORST.url,
    },
  ],
};

/** The calls a draft box makes: it saves, asks and undoes. */
export const DRAFT_CALLS: Record<"ok" | "pending" | "down", Call> = {
  /** Every call lands. */
  ok: answer({ ok: true }, 300),
  /** No call ever answers: a save stays "Saving". */
  pending: pending(),
  /** Every call is refused (a 400): a save says "Not saved" with Retry. */
  down: fails("The server refused this draft.", 400),
};

/**
 * Words typed and not yet saved, kept on the device the way the box keeps them: the box finds
 * them when it opens, says they are back and saves them. Seed before the box first draws.
 */
export function keepUnsaved(draft: RecordDraft, id: string, value: string) {
  writeEntry(EDITS.view(), `draft:${draft.save}:${id}`, {
    base: draft.text ?? "",
    version: null,
    value,
    at: Date.now(),
    tab: "",
  });
}
