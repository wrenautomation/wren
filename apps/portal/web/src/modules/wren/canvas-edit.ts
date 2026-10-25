/**
 * The canvas editor's state, in one reducer: open or not, Undo, the card or wire picked, the
 * palette, a drop's wire choices, Claude's answer, the publish confirm, the last error and the dry
 * test. The draft itself lives in the save engine (`useSaved`): this holds what goes around it.
 */
import type { Wire } from "@wren/core/workflows";
import { useReducer } from "react";
import type { DryStep } from "./dry.js";
import type { Draft } from "./wiring.js";

/** How far Undo goes back. */
export const UNDO_MOST = 50;

export interface Edit {
  editing: boolean;
  /** The drafts before each change, oldest first. */
  undo: Draft[];
  /** The card whose panel is open, or the wire's. One at a time. */
  sel: string | null;
  picked: { from: string; to: string } | null;
  /** The palette is open. */
  adding: boolean;
  /** A drop that fits more than one wire: he picks one. */
  choices: Wire[];
  busy: boolean;
  error: string | null;
  /** The builder's first ask (`?ask=`), waited on as the editor opens; cleared once answered. */
  pending: string | null;
  /** Claude's answer on the graph: a diff over the draft until he accepts or rejects it. */
  proposal: { reply: string; patch: Draft | null } | null;
  /** Publishing a workflow that sends or spends asks its id typed back: the server names the effects. */
  confirm: { asks: string } | null;
  /** The test panel is open, and the steps of the last dry run, lit until the draft changes. */
  testing: boolean;
  tested: { steps: readonly DryStep[]; from: string } | null;
}

export type EditAction =
  | { type: "open"; testing?: boolean }
  | { type: "close" }
  /** The draft changed from `was`: Undo can step back to it. */
  | { type: "changed"; was: Draft }
  | { type: "undone" }
  /** A card's panel opens (or none): a wire's closes. */
  | { type: "select"; id: string | null }
  /** A wire's panel opens (or none): a card's closes. */
  | { type: "pick"; wire: { from: string; to: string } | null }
  | { type: "palette"; open: boolean }
  | { type: "choices"; wires: Wire[] }
  | { type: "answered"; reply: string; patch: Draft | null }
  | { type: "proposed" }
  /** A write starts (`clear`: and the last error goes) or ends. */
  | { type: "busy"; on: boolean; clear?: boolean }
  /** A write was refused: a publish that asks its id typed opens the confirm, else the error. */
  | { type: "failed"; message: string }
  /** The publish confirm closes. */
  | { type: "cancel" }
  /** Test workflow pressed: the panel opens or closes, and a card's or wire's panel goes. */
  | { type: "test" }
  | { type: "tested"; result: Edit["tested"] };

export const closed = (pending: string | null = null): Edit => ({
  editing: false,
  undo: [],
  sel: null,
  picked: null,
  adding: false,
  choices: [],
  busy: false,
  error: null,
  pending,
  proposal: null,
  confirm: null,
  testing: false,
  tested: null,
});

export function edit(s: Edit, a: EditAction): Edit {
  switch (a.type) {
    case "open":
      return { ...s, editing: true, testing: s.testing || !!a.testing };
    case "close":
      // A pending ask stays: it is answered whether the editor is open or not.
      return closed(s.pending);
    case "changed":
      return {
        ...s,
        editing: true,
        undo: [...s.undo.slice(-(UNDO_MOST - 1)), a.was],
        tested: null,
      };
    case "undone":
      return s.undo.length ? { ...s, undo: s.undo.slice(0, -1), tested: null } : s;
    case "select":
      return { ...s, sel: a.id, picked: null };
    case "pick":
      return { ...s, picked: a.wire, sel: null };
    case "palette":
      return { ...s, adding: a.open };
    case "choices":
      return { ...s, choices: a.wires };
    case "answered":
      return {
        ...s,
        pending: null,
        sel: null,
        picked: null,
        adding: false,
        proposal: { reply: a.reply, patch: a.patch },
      };
    case "proposed":
      return { ...s, proposal: null };
    case "busy":
      return { ...s, busy: a.on, error: a.clear ? null : s.error };
    case "failed":
      return /to confirm$/.test(a.message)
        ? { ...s, confirm: { asks: a.message } }
        : { ...s, error: a.message };
    case "cancel":
      return { ...s, confirm: null };
    case "test":
      return {
        ...s,
        testing: !s.testing,
        tested: s.testing ? null : s.tested,
        sel: null,
        picked: null,
      };
    case "tested":
      return { ...s, tested: a.result };
  }
}

/**
 * The editor's state and its changes. `now` and `set` are the save engine's draft: a change
 * through `change` keeps the draft before it for Undo.
 */
export function useCanvasEdit(o: {
  ask: string | null;
  now: () => Draft;
  set: (next: Draft) => void;
}) {
  const [s, send] = useReducer(edit, o.ask, closed);
  return {
    s,
    send,
    /** Every change to the draft goes through here, so Undo can step back. */
    change: (next: Draft) => {
      send({ type: "changed", was: o.now() });
      o.set(next);
    },
    undo: () => {
      const last = s.undo.at(-1);
      if (!last) return;
      send({ type: "undone" });
      o.set(last);
    },
  };
}
