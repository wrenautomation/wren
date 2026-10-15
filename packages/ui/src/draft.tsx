/**
 * A draft finished in place (designs/2026-10-06-content-desk.md, 6): the record declares its draft
 * (`RecordExtras.draft`) and the detail shows it as a box, not a dialog. It saves through the save
 * engine (./save): as he types, on blur, on ⌘S, when the tab hides and on leaving; unsaved words
 * stay on the device until they save, so a reload gives them back.
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
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { type Action, type Call, callOnce } from "./action.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";
import { DictateField } from "./dictate.js";
import { draftSaving, type LiveText, withTurns } from "./draft-save.js";
import { type MessageKind, MessagePreview, shapeOf } from "./preview.js";
import { readEntry, writeEntry } from "./save/journal.js";
import { SaveConflict, SaveStatus, useSaved } from "./save/react.js";
import { InsertSnippet } from "./snippets.js";

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

/**
 * What's typed in the record's draft box now, unsaved too: a preview beside it reads it live.
 * A store, not a value, so only its readers draw again on each key, never the page.
 */
export const DraftText = createContext<LiveText | null>(null);
const NO_TEXT = () => null;
const NO_SUB = () => () => {};
/** The draft box's words as typed, or null where the record holds no box. */
export const useDraftText = () => {
  const live = useContext(DraftText);
  return useSyncExternalStore(
    live?.subscribe ?? NO_SUB,
    live?.get ?? NO_TEXT,
    live?.get ?? NO_TEXT,
  );
};

/** Words kept by the box before the save engine (`wren.draft:<key>`), moved into its journal once. */
function adoptKept(old: string, key: string) {
  try {
    const store = globalThis.localStorage;
    const raw = store?.getItem(`wren.draft:${old}`);
    if (!raw) return;
    store.removeItem(`wren.draft:${old}`);
    const k = JSON.parse(raw) as { base?: unknown; text?: unknown; at?: unknown };
    if (typeof k.base !== "string" || typeof k.text !== "string") return;
    if (readEntry(store, key, Date.now())) return;
    writeEntry(store, key, {
      base: k.base,
      version: null,
      value: k.text,
      at: Number(k.at),
      tab: "",
    });
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/**
 * The box. `actions` are the record's inline actions that apply to this row and this viewer: the
 * box offers only what is among them. `changed` reads the record again after Claude or an undo
 * wrote, or on a conflict; a save of his words never does: `wrote` patches them into the page
 * instead. `send` runs the send action (after the box saved).
 */
export function DraftBox({
  draft,
  id,
  actions,
  call,
  changed,
  wrote,
  at,
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
  /** The server holds `text` now: show it wherever the page shows this draft (write-through). */
  wrote?: ((text: string) => void) | undefined;
  /** The tick when the read of `draft.text` left (`useLoad`'s `at`): older reads never land. */
  at?: number | undefined;
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
  const old = `${draft.save ?? draft.label}:${id}`;
  const key = `draft:${old}`;
  useState(() => adoptKept(old, key));
  /** Lines his saves added to the thread, shown until a read holds them. */
  const [mine, setMine] = useState<DraftTurnLine[]>([]);
  const s = useSaved<string>(
    draftSaving({
      handler: save?.handler ?? null,
      id,
      key,
      server,
      at,
      call,
      changed,
      wrote,
      turned: (t) => setMine((m) => [...m, t]),
    }),
  );
  const text = s.value;
  const dirty = s.dirty;
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const boxId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const askBox = useRef<HTMLInputElement>(null);
  const told = useRef(onText);
  told.current = onText;
  useEffect(() => told.current?.(text), [text]);
  const [restored] = useState(() => s.restored && !s.conflict);
  useEffect(() => {
    if (restored) toast("Your unsaved words are back. They save now.");
  }, [restored]);

  /** Save what's typed, or `next` set first: true once the server holds it. */
  const flush = (next?: string) => {
    if (next !== undefined) s.set(next);
    return s.flush();
  };
  if (handle) handle.current = { flush: () => s.flush() };

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
      await callOnce(call, ask.handler, [id], { ids: [id], message: said });
      setMessage("");
      changed([id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };

  const turns = withTurns(draft.turns ?? [], mine);
  const last = turns.findLast((t) => t.state === "done" && t.draft !== null);
  const undoNow = async () => {
    // Unsaved typing goes first: back to what was saved.
    if (dirty) return void s.set(s.base);
    if (!undo) return;
    setUndoing(true);
    try {
      await callOnce(call, undo.handler, [id], { ids: [id] });
      changed([id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUndoing(false);
    }
  };

  // The keys only where there is a keyboard to press them.
  const hint = send ? "Saves as you type · ⌘↵ sends" : "Saves as you type";

  return (
    <section className="grid min-w-0 gap-3" aria-label={draft.label}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={boxId} className="text-[13px] font-medium text-(--ui-ink-2)">
          {draft.label}
        </label>
        {save ? <SaveStatus state={s} onRetry={() => void s.retry()} idle={hint} /> : null}
      </div>
      {s.conflict ? (
        <SaveConflict
          conflict={s.conflict}
          onKeepMine={() => void s.keepMine()}
          onTakeTheirs={s.takeTheirs}
        />
      ) : null}
      {draft.editor ? (
        draft.editor({
          text,
          setText: s.set,
          flush,
          editable: Boolean(save),
        })
      ) : save ? (
        <DictateField target={box}>
          <Textarea
            ref={box}
            id={boxId}
            value={text}
            onChange={(e) => s.set(e.target.value)}
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
          <InsertSnippet box={box} value={text} onChange={s.set} channel={draft.preview?.kind} />
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
