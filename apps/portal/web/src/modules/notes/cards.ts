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
    // Back to front, so the places already found stay true.
    const tr = editor.state.tr;
    const mention = editor.schema.nodes.mention;
    const fresh = editor.state.doc;
    for (let i = lines.length - 1; i >= 0; i--) {
      const at = lines[i];
      const card = out.cards[i];
      if (!at || !card || !mention) continue;
      tr.insert(at.end, [
        editor.schema.text(" "),
        mention.create({ id: `note:${card.id}`, label: `${CARD_LABEL}${card.column}` }),
      ]);
    }
    if (tr.doc !== fresh) editor.view.dispatch(tr);
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
