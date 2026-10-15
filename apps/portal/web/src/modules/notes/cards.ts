/**
 * Make card (designs/2026-10-14-boards.md): the selected lines (or the line the cursor is in)
 * each become a card on the workspace's Work board. The card's body links back to this note, and
 * a link to the card goes on the line with the column it started in.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { CARD_LABEL } from "@wren/notes/chips";
import { say } from "@wren/ui";
import { notes } from "./api.js";

export { CARD_LABEL };

const hasCard = (n: PmNode) => {
  let found = false;
  n.descendants((c) => {
    if (c.type.name === "mention" && String(c.attrs.label ?? "").startsWith(CARD_LABEL))
      found = true;
  });
  return found;
};

/** The lines a Make card would take: text blocks the selection touches, minus ones with a card. */
export function cardLines(editor: Editor): { node: PmNode; end: number }[] {
  const { from, to, empty } = editor.state.selection;
  const out: { node: PmNode; end: number }[] = [];
  editor.state.doc.nodesBetween(from, empty ? from : to, (node, pos) => {
    if (node.isTextblock) {
      if (node.textContent.trim() && !hasCard(node))
        out.push({ node, end: pos + node.nodeSize - 1 });
      return false;
    }
    return true;
  });
  return out;
}

type Made = { id: string; column: string | null };

/** A link to each card at the end of its line. */
export function putChips(editor: Editor, at: { end: number; card: Made | undefined }[]): void {
  const mention = editor.schema.nodes.mention;
  if (!mention) return;
  // Back to front, so the places already found stay true.
  const tr = editor.state.tr;
  for (const { end, card } of [...at].sort((a, b) => b.end - a.end)) {
    if (!card) continue;
    tr.insert(end, [
      editor.schema.text(" "),
      mention.create({ id: `note:${card.id}`, label: `${CARD_LABEL}${card.column ?? ""}` }),
    ]);
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** A line's words as the note's text has them: a mention reads `@<label>`. */
const lineText = (n: PmNode) => {
  let out = "";
  n.forEach((c) => {
    out += c.isText ? (c.text ?? "") : c.type.name === "mention" ? `@${c.attrs.label ?? ""}` : "";
  });
  return out;
};
const clean = (s: string) =>
  s
    .replace(/^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Where each of these lines ends in the note, if it's there and has no card yet. */
export function linesNamed(editor: Editor, lines: (string | null)[]): (number | null)[] {
  const ends = new Map<string, number>();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const key = clean(lineText(node));
    if (key && !hasCard(node) && !ends.has(key)) ends.set(key, pos + node.nodeSize - 1);
    return false;
  });
  const used = new Set<number>();
  return lines.map((l) => {
    const end = l ? ends.get(clean(l)) : undefined;
    if (end === undefined || used.has(end)) return null;
    used.add(end);
    return end;
  });
}

/** Make the cards, then put a link on each line. Returns how many were made. */
export async function makeCards(editor: Editor, client: string, noteId: string): Promise<number> {
  const lines = cardLines(editor);
  if (!lines.length) {
    say.failed(new Error("Put the cursor on a line with words, or select the lines."));
    return 0;
  }
  try {
    const out = await notes(client, "taskFromLine", {
      id: noteId,
      lines: lines.map((l) => l.node.textContent),
    });
    putChips(
      editor,
      lines.map((at, i) => ({ end: at.end, card: out.cards[i] })),
    );
    say.done(
      out.cards.length === 1
        ? `Made a card on ${out.board}.`
        : `Made ${out.cards.length} cards on ${out.board}.`,
    );
    return out.cards.length;
  } catch (err) {
    say.failed(err);
    return 0;
  }
}
