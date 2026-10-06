/**
 * Ask Claude on a draft (designs/2026-10-06-content-desk.md, 3): the actions, and the item's
 * thread oldest first. While Claude works the detail reads again every few seconds.
 */
import type { DraftTurn } from "@wren/core/ask";
import type { Action, RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";

const POLL_MS = 4000;

/**
 * Ask Claude and Undo on one page's drafts. `handler` names the page's kind: the Inbox's ids carry
 * theirs (`inbox`), a page's own don't (`post`, `comment`, `thread`).
 */
export const askActions = (handler: string, when: NonNullable<Action["when"]>): Action[] => [
  {
    id: "marketing.draftAsk",
    label: "Ask Claude",
    handler: `marketing/${handler}Ask`,
    ask: { field: "message", label: "What to change, or ask" },
    key: "c",
    when,
    done: () => "Asked. Claude's answer shows on the item.",
  },
  {
    id: "marketing.draftUndo",
    label: "Undo",
    handler: `marketing/${handler}Undo`,
    confirm: "Put back the draft from before the last change?",
    when,
    done: () => "Put back",
  },
];

const said = (t: DraftTurn) =>
  t.command === "draft-ask"
    ? `${t.by ?? "Someone"} asked`
    : t.command === "draft-set"
      ? `Set by ${t.by ?? "a terminal"}`
      : `Undone by ${t.by ?? "someone"}`;

function Thread({ turns }: { turns: DraftTurn[] }) {
  return (
    <ol className="grid list-none gap-4 p-0 text-[14px]">
      {turns.map((t) => (
        <li key={t.id} className="grid gap-1">
          <span className="text-[13px] text-(--ui-ink-2)">
            {said(t)} · {new Date(t.at).toLocaleString()}
          </span>
          {t.message ? <span className="whitespace-pre-wrap">{t.message}</span> : null}
          {t.state === "thinking" ? (
            <span className="text-(--ui-ink-3)">Claude is working on it…</span>
          ) : null}
          {t.reply ? (
            <span className="whitespace-pre-wrap text-(--ui-ink-2)">Claude: {t.reply}</span>
          ) : null}
          {t.draft ? (
            <span className="whitespace-pre-wrap border-(--ui-hair) border-l-2 pl-3">
              {t.draft}
            </span>
          ) : null}
          {t.error ? <span className="text-(--ui-bad)">{t.error}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** A page's extras, with the item's Ask Claude thread after them. */
export const withAsk =
  (extras?: ListPage["extras"]): NonNullable<ListPage["extras"]> =>
  (detail, at) => {
    const base: RecordExtras = extras ? extras(detail, at) : {};
    const turns = (detail as { ask?: DraftTurn[] } | null)?.ask;
    if (!turns?.length) return base;
    return {
      ...base,
      sections: [...(base.sections ?? []), ["Claude", <Thread key="claude" turns={turns} />]],
      ...(turns.some((t) => t.state === "thinking") ? { poll: POLL_MS } : {}),
    };
  };
