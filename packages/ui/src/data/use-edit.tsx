/**
 * One field's unsaved words (designs/2026-10-15-one-write-path.md, "Unsaved edits"). Every box in
 * the portal that edits something the server holds goes through `useEdit` (a box that saves as
 * you type goes through `useSaved`, a form through `useEditForm`; all three keep their words
 * in the one edits store, `./edits.ts`). The words stay until they are saved or discarded:
 * leaving the page, switching rows or apps, a reload or a closed tab gives them back, marked
 * unsaved. If the server's value moved meanwhile, both show and the person picks; neither is
 * ever overwritten silently.
 */
import { type ChangeEvent, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../controls.js";
import { EDITS } from "./edits.js";

const PREFIX = "wren.edit:";
/** Older words than this are dropped (the journal's week). */
const EDIT_MS = 7 * 24 * 3600_000;

interface EditEntry {
  /** What the server held when the typing started over it. */
  base: string;
  /** The server's version of `base`, where the record has one. */
  version: string | null;
  value: string;
  at: number;
}

export interface EditOptions {
  /** The server's version of `server` (a row version): moved versions mean moved words. */
  version?: string | null | undefined;
  /** For tests. */
  now?: () => number;
}

export interface EditConflictState {
  mine: string;
  theirs: string;
}

export interface Edit {
  /** What the box shows: the person's words, else the server's. */
  value: string;
  set: (value: string) => void;
  /** Words the server doesn't hold. */
  dirty: boolean;
  /** The words came back from before (another page, a reload). */
  restored: boolean;
  /** The server's value moved under the words: both, until the person picks. */
  conflict: EditConflictState | null;
  keepMine: () => void;
  takeTheirs: () => void;
  /** The server holds `value` now (the words sent): forget them, unless typed past. */
  saved: (value?: string) => void;
  /** Back to the server's value; the words are gone. */
  discard: () => void;
  /** Spread on the input: value, onChange, and the mark the lint guard looks for. */
  field: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    "data-edit": string;
  };
}

function readEdit(key: string, now: number): EditEntry | null {
  try {
    const raw = EDITS.view().getItem(PREFIX + key);
    const e = raw ? (JSON.parse(raw) as Partial<EditEntry>) : null;
    if (!e || typeof e.value !== "string" || typeof e.base !== "string") return null;
    if (now - Number(e.at ?? 0) >= EDIT_MS) return null;
    return {
      base: e.base,
      version: typeof e.version === "string" ? e.version : null,
      value: e.value,
      at: Number(e.at),
    };
  } catch {
    return null;
  }
}

function writeEdit(key: string, e: EditEntry | null) {
  const store = EDITS.view();
  if (e === null) store.removeItem(PREFIX + key);
  else store.setItem(PREFIX + key, JSON.stringify(e));
}

/** Does the entry stand on what the server holds now? */
const sameBase = (e: EditEntry, server: string, version: string | null) =>
  e.version !== null && version !== null ? e.version === version : e.base === server;

/**
 * The words typed into the field `key` (client, record and field: `deal:9:name`) over the
 * server's `server`. A null key keeps the words in this component only.
 */
export function useEdit(key: string | null, server: string, o: EditOptions = {}): Edit {
  const now = o.now ?? Date.now;
  const version = o.version ?? null;
  // A cross-tab change, or the device copy arriving, shows here.
  useSyncExternalStore(EDITS.subscribe, EDITS.snapshot, EDITS.snapshot);
  const [own, setOwn] = useState<EditEntry | null>(null);
  const entry = key ? readEdit(key, now()) : own;
  const [mounted] = useState(now);
  const keyRef = useRef(key);
  keyRef.current = key;
  const put = (e: EditEntry | null) => {
    if (keyRef.current) writeEdit(keyRef.current, e);
    else setOwn(e);
  };
  const conflict =
    entry && !sameBase(entry, server, version) && entry.value !== server
      ? { mine: entry.value, theirs: server }
      : null;
  // Words that match what the server holds now are no longer unsaved.
  const value = entry && (conflict || sameBase(entry, server, version)) ? entry.value : server;
  const dirty = !!entry && value !== server;
  const set = (v: string) => {
    const cur = keyRef.current ? readEdit(keyRef.current, now()) : own;
    const stillConflict = cur && !sameBase(cur, server, version) && cur.value !== server;
    if (!stillConflict && v === server) return put(null);
    put({
      base: stillConflict && cur ? cur.base : server,
      version: stillConflict && cur ? cur.version : version,
      value: v,
      at: now(),
    });
  };
  return {
    value,
    set,
    dirty,
    restored: dirty && !!entry && entry.at < mounted,
    conflict,
    keepMine: () => {
      const cur = keyRef.current ? readEdit(keyRef.current, now()) : own;
      if (cur) put({ base: server, version, value: cur.value, at: now() });
    },
    takeTheirs: () => put(null),
    saved: (sent) => {
      const cur = keyRef.current ? readEdit(keyRef.current, now()) : own;
      if (!cur || sent === undefined || cur.value === sent) return put(null);
      // Typed past what went: the rest stays, over what the server holds now.
      put({ base: sent, version: null, value: cur.value, at: now() });
    },
    discard: () => put(null),
    field: {
      value,
      onChange: (e) => set(e.target.value),
      "data-edit": key ?? "",
    },
  };
}

/** Both versions of a field that moved under the person's words; they pick one. */
export function EditConflict({
  conflict,
  onKeepMine,
  onTakeTheirs,
  what = "this",
}: {
  conflict: EditConflictState | null;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  what?: string;
}) {
  if (!conflict) return null;
  return (
    <div
      role="alert"
      data-edit-conflict
      className="grid gap-2 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-wash) p-3 text-[13px]"
    >
      <p className="text-(--ui-ink)">
        {what === "this" ? "This" : what} changed while your words waited. Pick one.
      </p>
      <div className="grid gap-1">
        <span className="text-[12px] text-(--ui-ink-2)">Yours, not saved</span>
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-(--ui-ink)">
          {conflict.mine || "(empty)"}
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-[12px] text-(--ui-ink-2)">Now saved</span>
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-(--ui-ink-2)">
          {conflict.theirs || "(empty)"}
        </div>
      </div>
      <div className="flex gap-2">
        <Button tone="primary" size="dense" onClick={onKeepMine}>
          Keep mine
        </Button>
        <Button tone="quiet" size="dense" onClick={onTakeTheirs}>
          Use saved
        </Button>
      </div>
    </div>
  );
}

/** The mark beside a box whose words came back unsaved. */
export function UnsavedMark({ edit }: { edit: Pick<Edit, "dirty" | "conflict"> }) {
  if (!edit.dirty || edit.conflict) return null;
  return (
    <span data-unsaved className="text-[12px] text-(--ui-ink-3)">
      Not saved yet
    </span>
  );
}
