/**
 * A folded row's messages (designs/2026-10-15-engage-threads.md): one person's comments in one
 * thread, newest first, each marked waiting or answered. The record type declares the fold
 * (`RecordFold`); every list, card and detail draws it from here.
 */
import type { FoldMessage, RecordMeta } from "@wren/core/records";
import { cn } from "cn";
import { exact, relative } from "./fields.js";
import { stripMarks } from "./sources.js";

type Row = Readonly<Record<string, unknown>>;

/** The row's messages when it stands for more than one; else null. */
export function foldOf(meta: Pick<RecordMeta, "fold">, row: Row): FoldMessage[] | null {
  if (!meta.fold) return null;
  const raw = row[meta.fold];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const out = list.flatMap((m) =>
    m && typeof m === "object" && typeof (m as FoldMessage).id === "string"
      ? [
          {
            id: (m as FoldMessage).id,
            text: String((m as FoldMessage).text ?? ""),
            at: String((m as FoldMessage).at ?? ""),
            state: String((m as FoldMessage).state ?? ""),
            open: !!(m as FoldMessage).open,
          },
        ]
      : [],
  );
  return out.length > 1 ? out : null;
}

const oneLine = (t: string) => stripMarks(t).replace(/\s+/g, " ").trim();

/** Waiting: a filled dot. Answered: a hollow one. Said in words for a screen reader. */
function Mark({ open }: { open: boolean }) {
  return (
    <span
      role="img"
      aria-label={open ? "Waiting" : "Answered"}
      className={cn(
        "mt-[0.42em] inline-block size-1.5 shrink-0 rounded-full",
        open ? "bg-(--ui-warn-ink)" : "border border-(--ui-ink-3)",
      )}
    />
  );
}

/**
 * Under a row's title: the newest messages, one line each, and how many more. `lines` caps
 * what shows (a table row keeps two, a card three).
 */
export function FoldPreview({
  messages,
  lines = 2,
  quiet,
  className,
}: {
  messages: readonly FoldMessage[];
  lines?: number;
  quiet?: boolean | undefined;
  className?: string;
}) {
  const shown = messages.slice(0, lines);
  const rest = messages.length - shown.length;
  return (
    <span data-fold={messages.length} className={cn("grid min-w-0 gap-0.5", className)}>
      {shown.map((m) => (
        <span key={m.id} className="flex min-w-0 items-start gap-1.5">
          <Mark open={m.open} />
          <span
            className={cn(
              "min-w-0 wrap-anywhere whitespace-normal",
              quiet || !m.open ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)",
            )}
          >
            {oneLine(m.text) || "-"}
          </span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="pl-3 text-[12px] text-(--ui-ink-3)">
          {rest === 1 ? "1 earlier message" : `${rest} earlier messages`}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The detail's list: every message, newest first, with when and whether it was answered. A
 * page that draws the thread (Engage's) replies to any of them there.
 */
export function FoldList({
  messages,
  current,
}: {
  messages: readonly FoldMessage[];
  /** The message the row stands for now: the one Reply answers. */
  current: string;
}) {
  const now = Date.now();
  return (
    <ol className="grid gap-3" data-fold-list="">
      {messages.map((m) => {
        const at = new Date(m.at);
        const ok = !Number.isNaN(at.getTime());
        return (
          <li
            key={m.id}
            className={cn(
              "grid gap-1 rounded-lg border px-3 py-2",
              m.id === current ? "border-(--ui-edge) bg-(--ui-band)" : "border-(--ui-hair)",
            )}
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-(--ui-ink-2)">
              <Mark open={m.open} />
              <span>{m.open ? "Waiting" : "Answered"}</span>
              {ok ? <span title={exact(at)}>{relative(at, now)}</span> : null}
              {m.id === current ? <span className="text-(--ui-ink-3)">Reply goes here</span> : null}
            </span>
            <span className="text-[14px] leading-[1.6] whitespace-pre-line text-pretty">
              {stripMarks(m.text)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
