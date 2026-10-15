/**
 * A draft finished in place (designs/2026-10-06-content-desk.md, 6): the record declares its draft
 * (`RecordExtras.draft`) and the detail shows it as a box, not a dialog. It saves as he types, on
 * blur, on ⌘S and when the tab hides; unsaved words stay on the device until they save, so a
 * reload gives them back.
 * ⌘Enter saves and runs the record's send action (its confirm still asks). A line under it asks
 * Claude; the turns show above that line, with Undo beside the newest change.
 */
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { Action, Call } from "./action.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";
import { DictateField } from "./dictate.js";
import { keepDraft, keptDraft } from "./draft-keep.js";
import { type MessageKind, MessagePreview, shapeOf } from "./preview.js";
import { InsertSnippet } from "./snippets.js";

/** Quiet this long after the last key, the words save. */
const AUTOSAVE_MS = 1_200;

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

/** What a custom editor gets: the words as typed, a setter, and the box's save. */
export interface DraftEditorProps {
  text: string;
  /** Change the words (unsaved, like typing). */
  setText: (text: string) => void;
  /** Save what's typed, or `next` (a split or a move, set and saved at once). */
  flush: (next?: string) => Promise<boolean>;
  /** False when the box only reads. */
  editable: boolean;
}
/** Draws the words in place of the textarea (an X thread's posts); save, Ask Claude, Undo stay. */
export type DraftEditor = (p: DraftEditorProps) => ReactNode;

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
  /** Draws the words its own way; the box keeps saving, asking and undoing. */
  editor?: DraftEditor | undefined;
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

/** What's typed in the record's draft box now, unsaved too: a preview beside it reads it live. */
export const DraftText = createContext<string | null>(null);
/** The draft box's words as typed, or null where the record holds no box. */
export const useDraftText = () => useContext(DraftText);

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
  between,
  framed = true,
  onText,
}: {
  draft: RecordDraft;
  id: string | number;
  actions: readonly Action[];
  call: Call;
  changed: (ids: (string | number)[]) => void;
  send?: (() => void) | undefined;
  handle?: { current: DraftHandle | null } | undefined;
  /** The record's own fields, drawn under the words and above Ask Claude. */
  between?: ReactNode;
  /** False when the preview sits beside the box: the box keeps only the counts. */
  framed?: boolean | undefined;
  /** Told each change to the words, saved or not. */
  onText?: ((text: string) => void) | undefined;
}) {
  const save = actions.find((a) => a.id === draft.save);
  const ask = actions.find((a) => a.id === draft.ask);
  const undo = actions.find((a) => a.id === draft.undo);
  const server = draft.text ?? "";
  /** Where this box's unsaved words wait on the device, so a reload gives them back. */
  const keyOf = `${draft.save ?? draft.label}:${id}`;
  /** What the server held when the box last matched it: a save writes only over this. */
  const [base, setBase] = useState(server);
  const [restored] = useState(() => keptDraft(keyOf, server));
  const [text, setText] = useState(restored ?? server);
  const [saved, setSaved] = useState<Saved>("idle");
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const boxId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const askBox = useRef<HTMLInputElement>(null);
  const dirty = text.trim() !== base.trim();
  const told = useRef(onText);
  told.current = onText;
  useEffect(() => told.current?.(text), [text]);
  useEffect(() => keepDraft(keyOf, base, text), [keyOf, base, text]);
  useEffect(() => {
    if (restored) toast("Your unsaved words are back. They save now.");
  }, [restored]);

  // A new read (Claude wrote, an undo, a save) shows in the box unless he is mid-edit.
  const live = useRef({ dirty, server });
  live.current = { dirty, server };
  /** The words and the saved base as they are now, not as a render saw them: a save queued behind another must start from where that one left off. */
  const textNow = useRef(text);
  textNow.current = text;
  const baseNow = useRef(base);
  /** Saved texts this box wrote over: a read that left before the save and lands after it is old, never shown. */
  const passed = useRef(new Set<string>());
  /** Saves the page hasn't read back yet: told on leaving the box, not on each pause. */
  const unread = useRef(false);
  const rebase = (b: string) => {
    baseNow.current = b;
    setBase(b);
  };
  // Only a new server text resets the box, and only the words that differ: trailing spaces he typed stay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rebase` only sets a ref and a state.
  useEffect(() => {
    if (live.current.dirty || passed.current.has(server.trim())) return;
    rebase(server);
    setText((t) => (t.trim() === server.trim() ? t : server));
  }, [server]);

  /** Save what's typed. Quiet saves (a pause, the tab hiding) don't make the page read it again. */
  const flush = async (next?: string, quiet = false): Promise<boolean> => {
    if (pending.current) await pending.current;
    const now = next ?? textNow.current;
    const from = baseNow.current;
    if (!save || now.trim() === from.trim()) {
      if (!quiet && unread.current) {
        unread.current = false;
        changed([id]);
      }
      return true;
    }
    const words = now.trim();
    const job = (async () => {
      setSaved("saving");
      try {
        await call(save.handler, { ids: [id], text: words, expect: from.trim() ? from : null });
        passed.current.add(from.trim());
        passed.current.delete(words);
        rebase(words);
        setSaved("saved");
        if (quiet) unread.current = true;
        else {
          unread.current = false;
          changed([id]);
        }
        return true;
      } catch (err) {
        setSaved("failed");
        // Someone (Claude) changed it meanwhile: his words stay in the box, a second save keeps them.
        rebase(live.current.server);
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
  if (handle) handle.current = { flush: () => flush() };
  const flushNow = useRef(flush);
  flushNow.current = flush;
  const tellPage = useRef(changed);
  tellPage.current = changed;
  // Leaving the record: what saved quietly is read once, so the list shows it.
  useEffect(
    () => () => {
      if (unread.current) tellPage.current([id]);
    },
    [id],
  );

  // It saves as he types, and when the tab hides or closes. A failed save waits for his ⌘S:
  // its words would land over someone else's change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each key restarts the wait.
  useEffect(() => {
    if (!save || !dirty || saved === "failed" || saved === "saving") return;
    const t = setTimeout(() => void flushNow.current(undefined, true), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [save, dirty, saved, text]);
  useEffect(() => {
    if (!save) return;
    const away = () => {
      if (document.visibilityState === "hidden") void flushNow.current(undefined, true);
    };
    const gone = () => void flushNow.current(undefined, true);
    document.addEventListener("visibilitychange", away);
    addEventListener("pagehide", gone);
    return () => {
      document.removeEventListener("visibilitychange", away);
      removeEventListener("pagehide", gone);
    };
  }, [save]);

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
  const hint = send ? "Saves as you type · ⌘↵ sends" : "Saves as you type";

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
      {draft.editor ? (
        draft.editor({
          text,
          setText: (next) => {
            setText(next);
            if (saved !== "saving") setSaved("idle");
          },
          flush: (next) => {
            if (next !== undefined) setText(next);
            return flush(next);
          },
          editable: Boolean(save),
        })
      ) : save ? (
        <DictateField target={box}>
          <Textarea
            ref={box}
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
        </DictateField>
      ) : (
        <p id={boxId} className="text-[14px] leading-[1.65] whitespace-pre-wrap break-words">
          {server || "No draft."}
        </p>
      )}
      {save && !draft.editor ? (
        <div className="-mt-1.5 flex">
          <InsertSnippet
            box={box}
            value={text}
            onChange={(next) => {
              setText(next);
              if (saved !== "saving") setSaved("idle");
            }}
            channel={draft.preview?.kind}
          />
        </div>
      ) : null}
      {draft.preview && text.trim() && !draft.editor ? (
        framed ? (
          <MessagePreview message={draft.preview} body={text} />
        ) : (
          <p className="text-[13px] text-(--ui-ink-2)">
            {shapeOf(draft.preview, text).join(" · ")}
          </p>
        )
      ) : null}
      {between}
      {turns.length ? <DraftTurns turns={turns} /> : null}
      {ask || (undo && (last || dirty)) ? (
        <div className="flex min-w-0 items-center gap-2">
          {ask ? (
            <DictateField target={askBox} line label="Dictate to Claude" className="flex-1">
              <Input
                ref={askBox}
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
              />
            </DictateField>
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
