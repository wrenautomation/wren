/**
 * Read aloud (designs/2026-10-07-dictation.md, Reading aloud): a speaker button that speaks a
 * piece of text, sentence by sentence. Press to start, press again to stop; one reading plays at
 * a time across the page. While it reads it shows moving bars and "2 of 5". The engine (which
 * voice, the speakers) is the app's, through `ReadingProvider`; without one the button hides.
 */
import { cn } from "cn";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export type ReadStatus =
  | { state: "ready" }
  | { state: "unavailable"; why: string }
  /** Turned off on this device: no button at all. */
  | { state: "off" };

export type ReadPhase =
  | { kind: "loading"; progress: number | null }
  | { kind: "reading"; at: number; of: number };

export interface ReadEvents {
  phase(p: ReadPhase): void;
  /** In plain words; the reading is over. */
  error(message: string): void;
  /** Finished, or stopped. */
  done(): void;
}

export interface ReadHandle {
  stop(): void;
}

export interface ReadingEngine {
  status(): ReadStatus;
  subscribe(fn: () => void): () => void;
  /** Starts reading `text`, stopping any other reading first. */
  read(text: string, on: ReadEvents): ReadHandle;
}

const Engine = createContext<ReadingEngine | null>(null);

export function ReadingProvider({
  engine,
  children,
}: {
  engine: ReadingEngine | null;
  children: ReactNode;
}) {
  return <Engine.Provider value={engine}>{children}</Engine.Provider>;
}

const OFF: ReadStatus = { state: "off" };
const never = () => () => {};

export function useReadStatus(): ReadStatus {
  const engine = useContext(Engine);
  return useSyncExternalStore(
    engine ? engine.subscribe : never,
    () => engine?.status() ?? OFF,
    () => OFF,
  );
}

/** Read aloud from anywhere (a menu item): same engine, no button state. */
export function useReadAloud(): ((text: string) => void) | null {
  const engine = useContext(Engine);
  const status = useReadStatus();
  if (!engine || status.state !== "ready") return null;
  return (text) => {
    engine.read(text, { phase: () => {}, error: () => {}, done: () => {} });
  };
}

type State = { kind: "idle" } | ReadPhase | { kind: "error"; message: string };

export function ReadAloud({
  text,
  label = "Read aloud",
  className,
}: {
  /** The words, or how to get them at the press (a box's current value). */
  text: string | (() => string);
  label?: string | undefined;
  className?: string | undefined;
}) {
  const engine = useContext(Engine);
  const status = useReadStatus();
  const [state, setState] = useState<State>({ kind: "idle" });
  const handle = useRef<ReadHandle | null>(null);
  const tip = useId();

  useEffect(
    () => () => {
      handle.current?.stop();
      handle.current = null;
    },
    [],
  );

  // An error fades on its own.
  useEffect(() => {
    if (state.kind !== "error") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 6000);
    return () => clearTimeout(t);
  }, [state]);

  if (!engine || status.state === "off") return null;
  const unavailable = status.state === "unavailable";
  const active = state.kind === "loading" || state.kind === "reading";

  const press = () => {
    if (handle.current) {
      handle.current.stop();
      return;
    }
    if (unavailable) return;
    const words = (typeof text === "function" ? text() : text).trim();
    if (!words) {
      setState({ kind: "error", message: "Nothing to read yet." });
      return;
    }
    const mine = { over: false };
    setState({ kind: "loading", progress: null });
    const h = engine.read(words, {
      phase: (p) => !mine.over && setState(p),
      error: (message) => {
        if (mine.over) return;
        mine.over = true;
        handle.current = null;
        setState({ kind: "error", message });
      },
      done: () => {
        if (mine.over) return;
        mine.over = true;
        handle.current = null;
        setState({ kind: "idle" });
      },
    });
    handle.current = h;
  };

  const note =
    state.kind === "loading"
      ? state.progress === null
        ? "Starting the voice"
        : `Loading the voice, ${Math.round(state.progress * 100)}%`
      : state.kind === "error"
        ? state.message
        : null;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={active ? "Stop reading" : label}
        aria-pressed={active}
        aria-disabled={unavailable || undefined}
        aria-describedby={note ? tip : undefined}
        title={unavailable ? status.why : active ? "Stop reading" : label}
        data-read={state.kind}
        onClick={press}
        className={cn(
          "inline-flex h-8 min-w-8 shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 rounded-(--ui-radius) border-0 bg-transparent px-2 text-(--ui-ink-2) outline-none hover:bg-(--ui-hover) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-accent)",
          active && "bg-(--ui-wash) text-(--ui-ink)",
          unavailable &&
            "cursor-default text-(--ui-ink-3) opacity-60 hover:bg-transparent hover:text-(--ui-ink-3)",
          className,
        )}
      >
        {state.kind === "reading" ? (
          <>
            <Bars />
            <span className="text-[12.5px] tabular-nums">
              {state.at + 1} of {state.of}
            </span>
          </>
        ) : (
          <Speaker />
        )}
      </button>
      {note ? (
        <span
          id={tip}
          role="status"
          className={cn(
            "pointer-events-none absolute top-full right-0 z-50 mt-1.5 w-max max-w-[min(20rem,calc(100vw-16px))] rounded-(--ui-radius) bg-(--ui-ink) px-2.5 py-1.5 text-[12.5px]/snug text-(--ui-on-ink) shadow-(--ui-shadow)",
            state.kind === "error" && "bg-(--ui-bad)",
          )}
        >
          {note}
        </span>
      ) : null}
    </span>
  );
}

function Speaker() {
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
      <path d="M2.5 6h2l3-2.5v9l-3-2.5h-2zM10.5 5.75a3 3 0 0 1 0 4.5M12.5 3.75a6 6 0 0 1 0 8.5" />
    </svg>
  );
}

/** Three bars that move while it speaks; still when motion is reduced. */
function Bars() {
  return (
    <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current motion-safe:animate-ui-read"
          style={{
            height: "100%",
            scale: "1 0.6",
            animationDelay: `${i * 150}ms`,
            transformOrigin: "bottom",
          }}
        />
      ))}
    </span>
  );
}
