/**
 * Suggesting (designs/2026-10-07-notes.md, batch 2), as in Docs: in suggest mode what you type
 * is marked as your suggestion (`suggestAdd`) and what you delete stays, struck through
 * (`suggestDel`), until someone who can edit accepts or rejects it. A commenter is always in
 * suggest mode; the server takes their change only when it suggests (`@wren/notes/suggest`).
 *
 * Suggestions change text inside a paragraph. A change across blocks (a new paragraph, a join,
 * a pasted list) or to formatting isn't taken in suggest mode, so it can't slip past as an edit.
 */
import { type Editor, Extension, Mark, mergeAttributes } from "@tiptap/core";
import type { Fragment, Mark as PmMark, Node as PmNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { SUGGEST_ADD, SUGGEST_DEL } from "@wren/notes/types";
import { hueClass } from "./api.js";

/** Changes made here skip the tracking: accepting, rejecting, the room's own updates. */
export const SUGGEST = new PluginKey<{ on: boolean }>("suggesting");

/** Who and when, rendered by the mark itself. */
const attrs = () => ({
  by: {
    default: "",
    rendered: false,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-by") ?? "",
  },
  at: {
    default: "",
    rendered: false,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-at") ?? "",
  },
});

const render =
  (tag: "ins" | "del", cls: string) =>
  ({ HTMLAttributes, mark }: { HTMLAttributes: Record<string, unknown>; mark: PmMark }) => {
    const by = String(mark.attrs.by ?? "");
    return [
      tag,
      mergeAttributes(HTMLAttributes, {
        class: `${cls} ${hueClass(by)}`,
        "data-by": by,
        "data-at": String(mark.attrs.at ?? ""),
        title: `${tag === "ins" ? "Added" : "Removed"} by ${by}`,
      }),
      0,
    ] as const;
  };

export const SuggestAdd = Mark.create({
  name: SUGGEST_ADD,
  inclusive: false,
  excludes: `${SUGGEST_ADD} ${SUGGEST_DEL}`,
  addAttributes: attrs,
  parseHTML: () => [{ tag: "ins[data-by]" }],
  renderHTML: render("ins", "note-sugg note-sugg-add") as never,
});

export const SuggestDel = Mark.create({
  name: SUGGEST_DEL,
  inclusive: false,
  excludes: `${SUGGEST_ADD} ${SUGGEST_DEL}`,
  addAttributes: attrs,
  parseHTML: () => [{ tag: "del[data-by]" }],
  renderHTML: render("del", "note-sugg note-sugg-del") as never,
});

/** To the minute: a run of typing is one suggestion. */
const minute = () => new Date().toISOString().slice(0, 16);

const fromRoom = (tr: Transaction) =>
  !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;

/** A step that only changes text in one paragraph: what suggest mode can track. */
function inline(step: unknown, doc: PmNode): step is ReplaceStep {
  if (!(step instanceof ReplaceStep)) return false;
  const s = step as ReplaceStep & { from: number; to: number; structure: boolean };
  const $from = doc.resolve(s.from);
  const $to = doc.resolve(s.to);
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return false;
  let content = s.slice.content;
  let open = Math.min(s.slice.openStart, s.slice.openEnd);
  if (s.slice.openStart !== s.slice.openEnd) return false;
  while (open > 0) {
    if (content.childCount !== 1 || !content.firstChild?.isTextblock) return false;
    content = content.firstChild.content;
    open--;
  }
  let ok = true;
  content.forEach((n) => {
    if (!n.isInline) ok = false;
  });
  return ok;
}

/** Whether `node` carries `who`'s suggested addition. */
const addedBy = (node: PmNode, who: string) =>
  node.marks.some((m) => m.type.name === SUGGEST_ADD && m.attrs.by === who);

export const Suggesting = Extension.create<{
  /** Who suggests: the signed-in email. */
  by: string;
  /** Whether suggest mode is on now. */
  on: () => boolean;
  /** A change suggest mode can't take. */
  onBlocked: () => void;
}>({
  name: "suggesting",
  addOptions: () => ({ by: "", on: () => false, onBlocked: () => {} }),
  addProseMirrorPlugins() {
    const { by, on, onBlocked } = this.options;
    const who = by.toLowerCase();
    return [
      new Plugin({
        key: SUGGEST,
        filterTransaction: (tr, state) => {
          if (!on() || !tr.docChanged || tr.getMeta(SUGGEST) || fromRoom(tr)) return true;
          let doc = state.doc;
          for (const step of tr.steps) {
            if (!inline(step, doc)) {
              onBlocked();
              return false;
            }
            const next = step.apply(doc).doc;
            if (!next) return false;
            doc = next;
          }
          return true;
        },
        appendTransaction: (trs, old, state) => {
          if (!on()) return null;
          const mine = trs.filter((t) => t.docChanged && !t.getMeta(SUGGEST) && !fromRoom(t));
          if (!mine.length) return null;
          return track(mine, old, state, who);
        },
      }),
    ];
  },
});

/** Turn the user's plain edits into suggestions: added text marked, removed text back, struck. */
function track(trs: Transaction[], old: EditorState, state: EditorState, who: string) {
  const at = minute();
  const add = state.schema.marks[SUGGEST_ADD]?.create({ by: who, at });
  const del = state.schema.marks[SUGGEST_DEL]?.create({ by: who, at });
  if (!add || !del) return null;
  // Every step, in order, with the doc it applied to.
  const steps: { step: ReplaceStep; doc: PmNode }[] = [];
  let doc = old.doc;
  for (const t of trs)
    for (const step of t.steps) {
      if (step instanceof ReplaceStep) steps.push({ step, doc });
      doc = step.apply(doc).doc ?? doc;
    }
  const all = trs.flatMap((t) => t.steps);
  const out = state.tr.setMeta(SUGGEST, true).setMeta("addToHistory", true);
  let caret: number | null = null;
  steps.forEach(({ step, doc: before }, i) => {
    const s = step as ReplaceStep & { from: number; to: number };
    // From this step's result to the doc now: the later steps, then our own changes so far.
    const later = all.slice(all.indexOf(step) + 1);
    const map = (pos: number, assoc: number) => {
      let p = pos;
      for (const l of later) p = l.getMap().map(p, assoc);
      return out.mapping.map(p, assoc);
    };
    let added = 0;
    step.getMap().forEach((_a, _b, newStart, newEnd) => {
      added += newEnd - newStart;
    });
    if (added) {
      const from = map(s.from, -1);
      const to = map(s.from + added, 1);
      out.removeMark(from, to, state.schema.marks[SUGGEST_DEL]);
      out.addMark(from, to, add);
    }
    if (s.to > s.from) {
      const $f = before.resolve(s.from);
      const gone: Fragment = $f.parent.content.cut(
        $f.parentOffset,
        $f.parentOffset + (s.to - s.from),
      );
      const back: PmNode[] = [];
      gone.forEach((n) => {
        // Their own suggestion, taken back: gone for real.
        if (addedBy(n, who)) return;
        const struck = n.marks.some((m) => m.type.name === SUGGEST_DEL);
        const kept = n.marks.filter((m) => m.type.name !== SUGGEST_ADD);
        back.push(n.mark(struck ? kept : del.addToSet(kept)));
      });
      if (back.length) {
        const pos = map(s.from, -1);
        out.insert(pos, back);
        const size = back.reduce((n, b) => n + b.nodeSize, 0);
        // Delete forward goes on past what it struck; Backspace stays before it.
        const forward =
          i === steps.length - 1 && old.selection.empty && old.selection.from === s.from;
        if (i === steps.length - 1 && !added) caret = forward ? pos + size : pos;
      }
    }
  });
  if (!out.docChanged) return null;
  if (caret !== null) out.setSelection(TextSelection.create(out.doc, caret));
  return out;
}

// ---- Reading and resolving ----------------------------------------------------------------------

/** One suggestion: one person's run of added and removed text in one paragraph. */
export interface Suggestion {
  from: number;
  to: number;
  by: string;
  at: string;
  added: string;
  removed: string;
}

export function suggestionsIn(doc: PmNode): Suggestion[] {
  const out: Suggestion[] = [];
  let open: Suggestion | null = null;
  let parent: PmNode | null = null;
  doc.descendants((node, pos, par) => {
    if (!node.isInline) {
      open = null;
      return true;
    }
    const m = node.marks.find((x) => x.type.name === SUGGEST_ADD || x.type.name === SUGGEST_DEL);
    if (!m) {
      open = null;
      return false;
    }
    const by = String(m.attrs.by ?? "");
    const text = node.text ?? (node.type.name === "mention" ? `@${node.attrs.label ?? ""}` : "");
    const run: Suggestion | null = open;
    if (run && run.by === by && run.to === pos && parent === par) {
      run.to = pos + node.nodeSize;
      if (m.type.name === SUGGEST_ADD) run.added += text;
      else run.removed += text;
    } else {
      const fresh: Suggestion = {
        from: pos,
        to: pos + node.nodeSize,
        by,
        at: String(m.attrs.at ?? ""),
        added: m.type.name === SUGGEST_ADD ? text : "",
        removed: m.type.name === SUGGEST_DEL ? text : "",
      };
      out.push(fresh);
      open = fresh;
      parent = par;
    }
    return false;
  });
  return out;
}

/** Accept (`keep`) or reject one suggestion, or all of them. */
export function resolveSuggestions(editor: Editor, keep: boolean, only?: Suggestion) {
  const { state } = editor;
  const list = only ? [only] : suggestionsIn(state.doc);
  const tr = state.tr.setMeta(SUGGEST, true);
  const addType = state.schema.marks[SUGGEST_ADD];
  const delType = state.schema.marks[SUGGEST_DEL];
  if (!addType || !delType) return;
  // From the end, so earlier positions hold.
  for (const s of [...list].sort((a, b) => b.from - a.from)) {
    const cuts: [number, number][] = [];
    state.doc.nodesBetween(s.from, s.to, (node, pos) => {
      if (!node.isInline) return true;
      const m = node.marks.find(
        (x) => (x.type === addType || x.type === delType) && x.attrs.by === s.by,
      );
      if (!m) return false;
      const goes = keep ? m.type === delType : m.type === addType;
      if (goes) cuts.push([pos, pos + node.nodeSize]);
      return false;
    });
    tr.removeMark(s.from, s.to, keep ? addType : delType);
    for (const [a, b] of cuts.reverse()) tr.delete(a, b);
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}
