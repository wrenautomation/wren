/**
 * Dictate (designs/2026-10-07-dictation.md): a mic button for a text box, inside it through
 * `DictateField` (bottom right of a textarea, the right end of a one-line input). Hold it, or
 * Alt+Space in the box, to talk; a short press toggles. While it hears, it shows a red dot, the
 * mic's level, "Listening" and the time. Partial words show greyed at the cursor, final words go
 * in at the cursor, and one ⌘Z right after takes the whole dictation out. The engine (which
 * model, the mic) is the app's, through `DictationProvider`; without one the button hides.
 */
import { cn } from "cn";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { caretPoint, type DictatedRun, grow, joinDictated, undoable } from "./dictate-text.js";

/** Whether dictation can run here, as the app's engine routes it. */
export type DictateStatus =
  | { state: "ready"; adapter: string }
  | { state: "unavailable"; why: string }
  /** He turned it off: no button at all. */
  | { state: "off" };

export type DictatePhase =
  | { kind: "loading"; progress: number | null }
  | { kind: "listening" }
  | { kind: "finishing" };

export interface DictateEvents {
  phase(p: DictatePhase): void;
  /** The mic's loudness, 0..1, a few times a second. */
  level(n: number): void;
  partial(text: string): void;
  final(text: string): void;
  /** In plain words; the dictation is over. */
  error(message: string): void;
  /** The last words are in. */
  done(): void;
}

export interface DictateHandle {
  /** Released: finish hearing, then `done`. */
  stop(): void;
  /** Dropped at once. */
  cancel(): void;
}

export interface DictationEngine {
  status(): DictateStatus;
  /** Calls `fn` when the status changes. */
  subscribe(fn: () => void): () => void;
  start(on: DictateEvents): DictateHandle;
}

const Engine = createContext<DictationEngine | null>(null);

export function DictationProvider({
  engine,
  children,
}: {
  engine: DictationEngine | null;
  children: ReactNode;
}) {
  return <Engine.Provider value={engine}>{children}</Engine.Provider>;
}

const OFF: DictateStatus = { state: "off" };
const never = () => () => {};

/** The engine's status, live; "off" with no engine. */
export function useDictateStatus(): DictateStatus {
  const engine = useContext(Engine);
  return useSyncExternalStore(
    engine ? engine.subscribe : never,
    () => engine?.status() ?? OFF,
    () => OFF,
  );
}

/** A press shorter than this toggles; longer is push to talk. */
const HOLD_MS = 300;
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const DICTATE_KEYS = MAC ? "⌥Space" : "Alt+Space";

type Field = HTMLTextAreaElement | HTMLInputElement;
type State = { kind: "idle" } | DictatePhase | { kind: "error"; message: string };

/** Sets a field's value the way typing does, so React's onChange sees it. */
function setValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Replaces `from..to` with `text` through the browser's editing, so its own undo keeps working. */
function edit(el: Field, from: number, to: number, text: string) {
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  el.setSelectionRange(from, to);
  const before = el.value;
  const done = text
    ? document.execCommand("insertText", false, text)
    : document.execCommand("delete", false);
  if (!done || el.value === before) {
    setValue(el, before.slice(0, from) + text + before.slice(to));
    el.setSelectionRange(from + text.length, from + text.length);
  }
}

/** 0:04, 1:12. */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A text box with its mic inside, as a chat composer has it: bottom right of a textarea, the
 * right end of a one-line input. The box keeps room for it, more while it hears.
 */
export function DictateField({
  target,
  line = false,
  off = false,
  label,
  className,
  children,
}: {
  target: RefObject<Field | null>;
  /** No mic, the box only: one he can't write in. */
  off?: boolean | undefined;
  /** A one-line input: the mic sits in its right end. */
  line?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const status = useDictateStatus();
  const [hearing, setHearing] = useState(false);
  const engine = useContext(Engine);
  const shows = !off && engine !== null && status.state !== "off";
  return (
    <div
      className={cn(
        "relative min-w-0",
        shows && (line ? "[&_input]:pr-9" : "[&_textarea]:pb-10"),
        shows && hearing && line && "[&_input]:pr-40 max-sm:[&_input]:pr-24",
        className,
      )}
    >
      {children}
      {off ? null : (
        <Dictate
          target={target}
          label={label}
          onHearing={setHearing}
          className={cn(
            "absolute",
            line ? "top-1 right-1 h-6 min-w-6 px-1.5" : "right-1.5 bottom-1.5 h-7 min-w-7",
          )}
        />
      )}
    </div>
  );
}

export function Dictate({
  target,
  className,
  label = "Dictate",
  onHearing,
}: {
  /** The box the words go into. */
  target: RefObject<Field | null>;
  className?: string | undefined;
  label?: string | undefined;
  /** Told when it starts and stops hearing, so a box can make room. */
  onHearing?: ((on: boolean) => void) | undefined;
}) {
  const engine = useContext(Engine);
  const status = useDictateStatus();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [partial, setPartial] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const live = useRef<{
    handle: DictateHandle | null;
    down: number;
    run: DictatedRun | null;
    ours: boolean;
  }>({
    handle: null,
    down: 0,
    run: null,
    ours: false,
  });
  const tip = useId();
  const active =
    state.kind === "loading" || state.kind === "listening" || state.kind === "finishing";
  const hearing = state.kind === "listening" || state.kind === "finishing";

  const begin = () => {
    const el = target.current;
    if (!engine || !el || live.current.handle) return;
    if (el.disabled || el.readOnly) return;
    if (status.state !== "ready") {
      setShown(status.state === "unavailable" ? status.why : null);
      return;
    }
    setShown(null);
    live.current.run = null;
    setState({ kind: "loading", progress: null });
    const mine = { over: false };
    const end = () => {
      mine.over = true;
      if (live.current.handle === handle) live.current.handle = null;
      setPartial("");
      setLevel(0);
    };
    const handle = engine.start({
      phase: (p) => {
        if (mine.over) return;
        if (p.kind === "listening") {
          const t = performance.now();
          setSince(t);
          setNow(t);
        }
        setState(p);
      },
      level: (n) => !mine.over && setLevel(n),
      partial: (t) => !mine.over && setPartial(t),
      final: (t) => {
        if (mine.over) return;
        const box = target.current;
        setPartial("");
        if (!box?.isConnected) return;
        const from = box.selectionStart ?? box.value.length;
        const to = box.selectionEnd ?? from;
        const piece = joinDictated(box.value.slice(0, from), t, box.value.slice(to));
        if (!piece) return;
        live.current.ours = true;
        edit(box, from, to, piece);
        live.current.ours = false;
        live.current.run = grow(from === to ? live.current.run : null, from, piece, box.value);
      },
      error: (message) => {
        if (mine.over) return;
        end();
        setState({ kind: "error", message });
      },
      done: () => {
        if (mine.over) return;
        end();
        setState({ kind: "idle" });
      },
    });
    live.current.handle = handle;
    live.current.down = performance.now();
  };
  const finish = () => {
    const h = live.current.handle;
    if (!h) return;
    setState({ kind: "finishing" });
    h.stop();
  };
  /** A press: start, or stop a running one. */
  const press = () => {
    if (live.current.handle) finish();
    else begin();
  };
  /** A release: a long press was push to talk, so it ends; a short one keeps going. */
  const release = () => {
    if (live.current.handle && performance.now() - live.current.down >= HOLD_MS) finish();
  };

  // Alt+Space in the box, and ⌘Z right after a dictation.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = target.current;
      if (!el || e.target !== el) return;
      if (e.code === "Space" && e.altKey && !e.metaKey && !e.ctrlKey) {
        // A Mac types a no-break space on ⌥Space.
        e.preventDefault();
        if (!e.repeat) press();
        return;
      }
      if (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const run = live.current.run;
        if (live.current.handle || !undoable(run, el.value)) return;
        e.preventDefault();
        live.current.ours = true;
        edit(el, run.start, run.start + run.text.length, "");
        live.current.ours = false;
        live.current.run = null;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.target !== target.current) return;
      if (e.code === "Space" || e.key === "Alt") release();
    };
    // Typing after a dictation makes it ordinary text: undo goes back to the browser.
    const typed = (e: Event) => {
      if (e.target === target.current && !live.current.ours) live.current.run = null;
    };
    document.addEventListener("keydown", down, true);
    document.addEventListener("keyup", up, true);
    document.addEventListener("input", typed, true);
    return () => {
      document.removeEventListener("keydown", down, true);
      document.removeEventListener("keyup", up, true);
      document.removeEventListener("input", typed, true);
    };
  });

  // The time it has heard, by the second.
  useEffect(() => {
    if (state.kind !== "listening") return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [state.kind]);

  useEffect(() => onHearing?.(hearing), [hearing, onHearing]);

  // Gone mid-dictation: drop it.
  useEffect(
    () => () => {
      live.current.handle?.cancel();
      live.current.handle = null;
    },
    [],
  );

  // A note fades on its own after a while; an error stays until the next press.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [shown]);

  if (!engine || status.state === "off") return null;
  const unavailable = status.state === "unavailable";
  const note =
    state.kind === "loading"
      ? state.progress === null
        ? "Starting the mic"
        : `Loading the speech model, ${Math.round(state.progress * 100)}%`
      : state.kind === "error"
        ? state.message
        : shown;
  const title = unavailable
    ? status.why
    : active
      ? "Stop dictating"
      : `${label} (hold ${DICTATE_KEYS} in the box, or hold here)`;

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={active ? "Stop dictating" : label}
        aria-pressed={active}
        aria-disabled={unavailable || undefined}
        aria-describedby={note ? tip : undefined}
        title={title}
        data-dictate={state.kind}
        className={cn(
          "inline-flex h-8 min-w-8 shrink-0 cursor-pointer touch-none select-none border-0 bg-transparent items-center justify-center gap-1.5 rounded-(--ui-radius) px-2 text-(--ui-ink-2) outline-none hover:bg-(--ui-hover) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-accent)",
          active && "bg-(--ui-wash) text-(--ui-ink)",
          unavailable &&
            "cursor-default text-(--ui-ink-3) opacity-60 hover:bg-transparent hover:text-(--ui-ink-3)",
          className,
        )}
        // The box keeps the focus, so the words go where the cursor is.
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onClick={(e) => {
          // Enter or Space on the button itself (a pointer press already ran).
          if (e.detail === 0) press();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {hearing ? (
          <>
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full bg-(--ui-bad)",
                state.kind === "finishing" && "bg-(--ui-ink-3)",
              )}
            />
            <span
              aria-hidden
              className="h-1.5 w-6 shrink-0 overflow-hidden rounded-full bg-(--ui-tile)"
            >
              <span
                className="block h-full origin-left rounded-full bg-(--ui-ink-2)"
                style={{ transform: `scaleX(${Math.min(1, level * 4).toFixed(3)})` }}
              />
            </span>
            <span className="text-[12.5px] text-(--ui-ink) max-sm:hidden">
              {state.kind === "finishing" ? "Finishing" : "Listening"}
            </span>
            <span className="text-[12.5px] text-(--ui-ink-2) tabular-nums">
              {clock(since === null ? 0 : now - since)}
            </span>
          </>
        ) : (
          <Mic />
        )}
      </button>
      {note ? (
        <Note
          id={tip}
          anchor={button}
          tone={state.kind === "error" ? "bad" : "plain"}
          text={note}
        />
      ) : null}
      {partial && target.current ? <Ghost field={target.current} text={partial} /> : null}
    </>
  );
}

function Mic() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.75a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0v-4a2 2 0 0 0-2-2ZM4 7.25a4 4 0 0 0 8 0M8 11.25v3" />
    </svg>
  );
}

/** What's happening, under the button: loading, an error in words. */
function Note({
  id,
  anchor,
  text,
  tone,
}: {
  id: string;
  anchor: RefObject<HTMLButtonElement | null>;
  text: string;
  tone: "bad" | "plain";
}) {
  const box = anchor.current?.getBoundingClientRect();
  if (!box) return null;
  const right = Math.max(8, innerWidth - box.right);
  return createPortal(
    <span
      id={id}
      role="status"
      className={cn(
        "pointer-events-none fixed z-50 max-w-[min(20rem,calc(100vw-16px))] rounded-(--ui-radius) bg-(--ui-ink) px-2.5 py-1.5 text-[12.5px]/snug text-(--ui-on-ink) shadow-(--ui-shadow)",
        tone === "bad" && "bg-(--ui-bad)",
      )}
      style={{ top: box.bottom + 6, right }}
    >
      {text}
    </span>,
    document.body,
  );
}

/** The partial words, greyed, where the cursor is. */
function Ghost({ field, text }: { field: Field; text: string }) {
  const at = field.selectionEnd ?? field.value.length;
  const p = caretPoint(field, at);
  const box = field.getBoundingClientRect();
  const css = getComputedStyle(field);
  // Up to the box's padding, so a mic inside it stays clear.
  const right = box.right - parseFloat(css.paddingRight) - parseFloat(css.borderRightWidth);
  const width = Math.max(40, right - p.left);
  const shown = text.length > 80 ? `…${text.slice(-79)}` : text;
  return createPortal(
    <span
      aria-hidden
      data-dictate-partial
      className="pointer-events-none fixed z-40 overflow-hidden text-ellipsis whitespace-nowrap bg-(--ui-paper) text-(--ui-ink-3) italic"
      style={{
        left: p.left,
        top: p.top,
        maxWidth: width,
        // An empty box shows its placeholder: cover it.
        minWidth: field.value ? undefined : width,
        lineHeight: `${p.height}px`,
        font: css.font,
      }}
    >
      {shown}
    </span>,
    document.body,
  );
}
