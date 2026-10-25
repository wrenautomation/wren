/**
 * `useEdit` for a value that isn't one string: a rule tree, a list of stages, a row of weights.
 * The edits store holds text, so the value is kept as JSON. `show` says a value in words, for
 * the conflict card.
 */
import { type Edit, type EditConflictState, useEdit } from "@wren/ui";
import { useMemo } from "react";

interface EditJson<T> {
  value: T;
  set: (value: T) => void;
  dirty: boolean;
  restored: boolean;
  /** Both versions in words (`show`), for `<EditConflict>`. */
  conflict: EditConflictState | null;
  keepMine: () => void;
  takeTheirs: () => void;
  saved: (sent?: T) => void;
  discard: () => void;
  /** For `data-edit` on the boxes inside. */
  key: string;
  edit: Edit;
}

function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function useEditJson<T>(
  key: string | null,
  server: T,
  o: { version?: string | null | undefined; show?: (v: T) => string } = {},
): EditJson<T> {
  const text = JSON.stringify(server);
  const edit = useEdit(key, text, o.version === undefined ? {} : { version: o.version });
  const show = o.show ?? ((v: T) => JSON.stringify(v));
  const c = edit.conflict;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `server` is read through `text`.
  const value = useMemo(() => parse(edit.value, server), [edit.value, text]);
  return {
    value,
    set: (v) => edit.set(JSON.stringify(v)),
    dirty: edit.dirty,
    restored: edit.restored,
    conflict: c
      ? { mine: show(parse(c.mine, server)), theirs: show(parse(c.theirs, server)) }
      : null,
    keepMine: edit.keepMine,
    takeTheirs: edit.takeTheirs,
    saved: (sent) => edit.saved(sent === undefined ? undefined : JSON.stringify(sent)),
    discard: edit.discard,
    key: key ?? "",
    edit,
  };
}
