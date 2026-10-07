/**
 * Snippets in any draft or reply box: Insert opens the team's saved replies and blocks (the
 * Library's), favorites first, and puts the one picked where the cursor is. The portal gives the
 * source; without one (a client, the demo) no box shows Insert.
 */
import { cn } from "cn";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";

export interface SnippetLine {
  id: number;
  title: string;
  body: string;
  tags: string[];
  /** Where it fits: email, sms, dm, comment, or any. */
  channel: string;
}

export interface SnippetsSource {
  list: () => Promise<SnippetLine[]>;
  /** His favorites' ids, kept in his prefs. */
  favorites: () => Promise<number[]>;
  setFavorites: (ids: number[]) => Promise<unknown>;
}

const Snippets = createContext<SnippetsSource | null>(null);

export function SnippetsProvider({
  source,
  children,
}: {
  source: SnippetsSource | null;
  children: ReactNode;
}) {
  return <Snippets.Provider value={source}>{children}</Snippets.Provider>;
}

export const useSnippets = () => useContext(Snippets);

/** The text with `body` put over the selection (or at the cursor), and where the cursor lands. */
export function insertAt(
  text: string,
  body: string,
  start = text.length,
  end = start,
): { text: string; at: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return { text: text.slice(0, a) + body + text.slice(b), at: a + body.length };
}

/** Favorites first, then by title; a search keeps those whose title, words or tags hold it. */
export function pickable(all: readonly SnippetLine[], favorites: readonly number[], q: string) {
  const words = q.trim().toLowerCase();
  const hit = (s: SnippetLine) =>
    !words || [s.title, s.body, s.tags.join(" ")].some((t) => t.toLowerCase().includes(words));
  const fav = new Set(favorites);
  return all
    .filter(hit)
    .sort(
      (a, b) => Number(fav.has(b.id)) - Number(fav.has(a.id)) || a.title.localeCompare(b.title),
    );
}

/** His favorites, read once per source and changed in place. */
export function useFavorites(source: SnippetsSource | null) {
  const [ids, setIds] = useState<number[]>([]);
  // A star pressed before the read lands wins over what the read says.
  const touched = useRef(false);
  useEffect(() => {
    if (!source) return;
    let live = true;
    touched.current = false;
    source
      .favorites()
      .then((f) => live && !touched.current && setIds(f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source]);
  const toggle = (id: number) => {
    if (!source) return;
    touched.current = true;
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);
    source.setFavorites(next).catch(() => setIds(ids));
  };
  return { ids, toggle };
}

const STAR =
  "M8 2.2l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.2l-3.52 1.85.68-3.93L2.3 6.35l3.95-.55z";

/** A star that favorites a snippet. */
export function FavoriteStar({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Unfavorite ${label}` : `Favorite ${label}`}
      title={on ? "Favorite" : "Make it a favorite"}
      onClick={onToggle}
      className="inline-flex size-7 flex-none items-center justify-center border-0 bg-transparent text-(--ui-ink-3) hover:text-(--ui-ink) aria-pressed:text-(--ui-accent)"
    >
      <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden="true">
        <path
          d={STAR}
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1.3}
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * Insert: the team's snippets in a popover, picked by click or Enter, put into `box` where its
 * cursor is. Nothing shows without a source.
 */
export function InsertSnippet({
  box,
  value,
  onChange,
  channel,
}: {
  box: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** The box's channel: its snippets and the ones that fit anywhere come first. */
  channel?: string | undefined;
}) {
  const source = useSnippets();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<SnippetLine[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const fav = useFavorites(open ? source : null);
  // Whether he has put the cursor in the box: until then a snippet goes at the end.
  const placed = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mark = () => {
      placed.current = true;
    };
    el.addEventListener("pointerup", mark);
    el.addEventListener("keyup", mark);
    return () => {
      el.removeEventListener("pointerup", mark);
      el.removeEventListener("keyup", mark);
    };
  }, [box]);
  useEffect(() => {
    if (!open || !source) return;
    setFailed(null);
    source
      .list()
      .then(setAll)
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [open, source]);
  const shown = useMemo(() => {
    const fits = (all ?? []).filter(
      (s) => !channel || s.channel === "any" || s.channel === channel,
    );
    return pickable(fits, fav.ids, q);
  }, [all, fav.ids, q, channel]);
  if (!source) return null;
  const put = (s: SnippetLine) => {
    const el = box.current;
    const where = placed.current && el ? [el.selectionStart, el.selectionEnd] : [value.length];
    // At the end of words already there, it starts a new paragraph.
    const end = where[0] === value.length && value.trim();
    const gap = !end || value.endsWith("\n\n") ? "" : value.endsWith("\n") ? "\n" : "\n\n";
    const { text, at: caret } = insertAt(value, gap + s.body, where[0], where[1]);
    onChange(text);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQ("");
          setAt(0);
        }
      }}
    >
      <PopoverTrigger className="inline-flex h-7 items-center border-0 bg-transparent px-1.5 text-[12.5px] font-medium text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)">
        Insert snippet
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] gap-0 rounded-none p-1.5 ring-(--ui-hair) shadow-lg"
      >
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = shown.length;
              if (n) setAt((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const s = shown[at];
              if (s) put(s);
            }
          }}
          placeholder="Search snippets"
          aria-label="Search snippets"
          className="mb-1 h-8 w-full border border-(--ui-edge) bg-(--ui-paper) px-2 text-[13px] outline-none placeholder:text-(--ui-ink-3) focus:border-(--ui-accent) focus:shadow-[0_0_0_1px_var(--ui-accent)]"
        />
        {failed ? (
          <p className="px-1.5 py-2 text-[12.5px] text-(--ui-bad)">{failed}</p>
        ) : !all ? (
          <p className="px-1.5 py-2 text-[12.5px] text-(--ui-ink-3)">Loading snippets</p>
        ) : !shown.length ? (
          <p className="px-1.5 py-2 text-[12.5px] text-(--ui-ink-3)">
            {all.length ? "None match." : "No snippets yet. Add them in the Library."}
          </p>
        ) : (
          <ul className="grid max-h-72 list-none gap-px overflow-y-auto">
            {shown.map((s, i) => (
              <li key={s.id} className="flex items-start gap-0.5">
                <button
                  type="button"
                  data-active={i === at || undefined}
                  onMouseEnter={() => setAt(i)}
                  onClick={() => put(s)}
                  className={cn(
                    "grid min-w-0 flex-1 gap-0.5 border-0 bg-transparent px-1.5 py-1.5 text-left",
                    i === at && "bg-(--ui-hover)",
                  )}
                >
                  <span className="truncate text-[13px] font-medium text-(--ui-ink)">
                    {s.title}
                  </span>
                  <span className="line-clamp-2 text-[12px] text-(--ui-ink-2)">{s.body}</span>
                </button>
                <FavoriteStar
                  on={fav.ids.includes(s.id)}
                  label={s.title}
                  onToggle={() => fav.toggle(s.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
