/**
 * A draft finished in place (designs/2026-10-06-content-desk.md, 6): the record declares its draft
 * (`RecordExtras.draft`) and the detail shows it as a box, not a dialog. Blur and ⌘S save it,
 * ⌘Enter saves and runs the record's send action (its confirm still asks). A line under it asks
 * Claude; the turns show above that line, with Undo beside the newest change.
 */
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { Action, Call } from "./action.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";
import { type MessageKind, MessagePreview } from "./preview.js";

/** One turn on a draft, oldest first (`@wren/core/ask` DraftTurn). */
export interface DraftTurnLine {
  id: string;
  command: string;
  by: string | null;
  message: string | null;
  at: string;
  state: "thinking" | "done" | "failed";
  reply: string | null;
  draft: string | null;
  error: string | null;
}

/** What a record says about the draft it holds. The actions are ids among the record's own. */
export interface RecordDraft {
  /** The row's field it stands in for: the details leave that field out. */
  field: string;
  label: string;
  /** The draft now; null = none yet. */
  text: string | null;
  turns?: DraftTurnLine[] | undefined;
  /** How it looks where it goes, drawn as he types. */
  preview?: MessageKind | null | undefined;
  /** Saves it: called with `{ ids, text, expect }`. Without it (or not applying) the box reads only. */
  save: string;
  /** Asks Claude: `{ ids, message }`. */
  ask?: string | undefined;
  /** Puts back the text before the newest change: `{ ids }`. */
  undo?: string | undefined;
  /** What ⌘Enter runs: one of the record's head actions. */
  send?: string | undefined;
}

/** What the box's owner holds: save what's typed first, then send. */
export interface DraftHandle {
  /** Saves what's typed; false when it couldn't. */
  flush: () => Promise<boolean>;
}

// "draft-ask", "video-ask"; "draft-undo", "video undo"; the rest are edits.
const said = (t: DraftTurnLine) =>
  t.command.endsWith("ask")
    ? `${t.by ?? "Someone"} asked`
    : t.command.endsWith("undo")
      ? `Undone by ${t.by ?? "someone"}`
      : `Edited by ${t.by ?? "a terminal"}`;

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** The draft's turns, oldest first. */
export function DraftTurns({ turns }: { turns: readonly DraftTurnLine[] }) {
  return (
    <ol className="grid list-none gap-4 p-0 text-[14px]">
      {turns.map((t) => (
        <li key={t.id} className="grid min-w-0 gap-1">
          <span className="text-[13px] text-(--ui-ink-2)">
            {said(t)} · {when(t.at)}
          </span>
          {t.message ? <span className="whitespace-pre-wrap break-words">{t.message}</span> : null}
          {t.state === "thinking" ? (
            <span className="animate-pulse text-(--ui-ink-3) motion-reduce:animate-none">
              Claude is working on it…
            </span>
          ) : null}
          {t.reply ? (
            <span className="whitespace-pre-wrap break-words text-(--ui-ink-2)">
              Claude: {t.reply}
            </span>
          ) : null}
          {t.draft && t.command === "draft-ask" ? (
            <span className="whitespace-pre-wrap break-words border-(--ui-hair) border-l-2 pl-3">
              {t.draft}
            </span>
          ) : null}
          {t.error ? <span className="text-(--ui-bad)">{t.error}</span> : null}
        </li>
      ))}
    </ol>
  );
}

type Saved = "idle" | "saving" | "saved" | "failed";

/**
 * The box. `actions` are the record's inline actions that apply to this row and this viewer: the
 * box offers only what is among them. `changed` reads the record again after a write; `send`
 * runs the send action (after the box saved).
 */
export function DraftBox({
  draft,
  id,
  actions,
  call,
  changed,
  send,
  handle,
}: {
  draft: RecordDraft;
  id: string | number;
  actions: readonly Action[];
  call: Call;
  changed: (ids: (string | number)[]) => void;
  send?: (() => void) | undefined;
  handle?: { current: DraftHandle | null } | undefined;
}) {
  const save = actions.find((a) => a.id === draft.save);
  const ask = actions.find((a) => a.id === draft.ask);
  const undo = actions.find((a) => a.id === draft.undo);
  const server = draft.text ?? "";
  /** What the server held when the box last matched it: a save writes only over this. */
  const [base, setBase] = useState(server);
  const [text, setText] = useState(server);
  const [saved, setSaved] = useState<Saved>("idle");
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const boxId = useId();
  const dirty = text.trim() !== base.trim();

  // A new read (Claude wrote, an undo, a save) shows in the box unless he is mid-edit.
  const live = useRef({ dirty, server });
  live.current = { dirty, server };
  // Only a new server text resets the box.
  useEffect(() => {
    if (live.current.dirty) return;
    setBase(server);
    setText(server);
  }, [server]);

  const flush = async (): Promise<boolean> => {
    if (pending.current) await pending.current;
    if (!save || text.trim() === base.trim()) return true;
    const words = text.trim();
    const job = (async () => {
      setSaved("saving");
      try {
        await call(save.handler, { ids: [id], text: words, expect: base.trim() ? base : null });
        setBase(words);
        setText(words);
        setSaved("saved");
        changed([id]);
        return true;
      } catch (err) {
        setSaved("failed");
        // Someone (Claude) changed it meanwhile: his words stay in the box, a second save keeps them.
        setBase(live.current.server);
        toast.error(
          `${err instanceof Error ? err.message : String(err)}. Your words are still in the box.`,
        );
        changed([]);
        return false;
      }
    })();
    pending.current = job;
    try {
      return await job;
    } finally {
      pending.current = null;
    }
  };
  if (handle) handle.current = { flush };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "s") {
      e.preventDefault();
      void flush();
    } else if (e.key === "Enter" && send) {
      e.preventDefault();
      void flush().then((ok) => ok && send());
    }
  };

  const askNow = async () => {
    const said = message.trim();
    if (!ask || !said || asking) return;
    setAsking(true);
    try {
      // Claude reads the saved draft: what he typed goes first.
      if (!(await flush())) return;
      await call(ask.handler, { ids: [id], message: said });
      setMessage("");
      changed([id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };

  const turns = draft.turns ?? [];
  const last = turns.findLast((t) => t.state === "done" && t.draft !== null);
  const undoNow = async () => {
    // Unsaved typing goes first: back to what was saved.
    if (dirty) return void setText(base);
    if (!undo) return;
    setUndoing(true);
    try {
      await call(undo.handler, { ids: [id] });
      changed([id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUndoing(false);
    }
  };

  const status =
    saved === "saving"
      ? "Saving…"
      : dirty
        ? saved === "failed"
          ? "Not saved"
          : "Edited"
        : saved === "saved"
          ? "Saved"
          : null;
  // The keys only where there is a keyboard to press them.
  const hint = send ? "⌘S saves · ⌘↵ sends" : "⌘S saves";

  return (
    <section className="grid min-w-0 gap-3" aria-label={draft.label}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={boxId} className="text-[13px] font-medium text-(--ui-ink-2)">
          {draft.label}
        </label>
        {save ? (
          <span
            aria-live="polite"
            className={
              saved === "failed" && dirty
                ? "text-[12px] text-(--ui-bad)"
                : status
                  ? "text-[12px] text-(--ui-ink-2)"
                  : "text-[12px] text-(--ui-ink-3) max-sm:hidden"
            }
          >
            {status ?? hint}
          </span>
        ) : null}
      </div>
      {save ? (
        <Textarea
          id={boxId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (saved !== "saving") setSaved("idle");
          }}
          onBlur={() => void flush()}
          onKeyDown={keys}
          rows={5}
          placeholder="Write it here."
          className="min-h-28 text-[14px] leading-[1.6]"
        />
      ) : (
        <p id={boxId} className="text-[14px] leading-[1.65] whitespace-pre-wrap break-words">
          {server || "No draft."}
        </p>
      )}
      {draft.preview ? <MessagePreview message={draft.preview} body={text} /> : null}
      {turns.length ? <DraftTurns turns={turns} /> : null}
      {ask || (undo && (last || dirty)) ? (
        <div className="flex min-w-0 items-center gap-2">
          {ask ? (
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void askNow();
                }
              }}
              disabled={asking}
              placeholder="Ask Claude: what to change, or a question"
              aria-label="Ask Claude"
              maxLength={2000}
              className="min-w-0 flex-1"
            />
          ) : null}
          {undo && (last || dirty) ? (
            <Button tone="quiet" size="dense" busy={undoing} onClick={() => void undoNow()}>
              Undo
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
