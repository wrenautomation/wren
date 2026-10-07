/**
 * Dictated words in a text box: the spacing and the capital they take from what's around the
 * cursor, and the caret's place on screen for the greyed partial. No React.
 */

const SENTENCE_END = /(^|[.!?]\s*|\n\s*)$/;

/**
 * What goes in at the cursor: a space before unless the text before ends in one (or the words
 * start with punctuation or a line break), a capital at a sentence's start, a space after when a
 * word follows straight on.
 */
export function joinDictated(before: string, said: string, after = ""): string {
  let piece = said.replace(/^[ \t]+|[ \t]+$/g, "");
  if (!piece) return "";
  if (SENTENCE_END.test(before)) piece = piece.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  if (before && !/\s$/.test(before) && !/^[\n.,!?;:]/.test(piece)) piece = ` ${piece}`;
  if (after && /^[\p{L}\p{N}]/u.test(after) && !/\s$/.test(piece)) piece = `${piece} `;
  return piece;
}

/** The text a field shows before a dictation's run: what one undo puts back. */
export interface DictatedRun {
  start: number;
  text: string;
  /** The field's value right after the run: anything typed since and undo leaves it alone. */
  value: string;
}

/** The run grown by `piece` at `at`, or a new run when `piece` doesn't follow it. */
export function grow(
  run: DictatedRun | null,
  at: number,
  piece: string,
  value: string,
): DictatedRun {
  if (run && run.start + run.text.length === at)
    return { start: run.start, text: run.text + piece, value };
  return { start: at, text: piece, value };
}

/** May one undo take the run out of `value`? */
export const undoable = (run: DictatedRun | null, value: string): run is DictatedRun =>
  !!run && run.value === value && value.slice(run.start, run.start + run.text.length) === run.text;

const COPIED = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "wordSpacing",
  "tabSize",
] as const;

/** Where the caret at `pos` sits on screen: a hidden copy of the field, measured. */
export function caretPoint(
  el: HTMLTextAreaElement | HTMLInputElement,
  pos: number,
): { left: number; top: number; height: number } {
  const css = getComputedStyle(el);
  const copy = document.createElement("div");
  for (const k of COPIED) copy.style[k] = css[k];
  copy.style.position = "absolute";
  copy.style.visibility = "hidden";
  copy.style.top = "0";
  copy.style.left = "-9999px";
  copy.style.overflow = "hidden";
  const area = el instanceof HTMLTextAreaElement;
  copy.style.whiteSpace = area ? "pre-wrap" : "pre";
  copy.style.overflowWrap = area ? "break-word" : "normal";
  copy.textContent = el.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = el.value.slice(pos) || ".";
  copy.appendChild(mark);
  document.body.appendChild(copy);
  const box = el.getBoundingClientRect();
  const lineHeight = Number.parseFloat(css.lineHeight) || Number.parseFloat(css.fontSize) * 1.3;
  const out = {
    // Offsets count from inside the copy's border.
    left: box.left + Number.parseFloat(css.borderLeftWidth) + mark.offsetLeft - el.scrollLeft,
    top: box.top + Number.parseFloat(css.borderTopWidth) + mark.offsetTop - el.scrollTop,
    height: lineHeight,
  };
  copy.remove();
  return out;
}
