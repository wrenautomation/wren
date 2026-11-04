/**
 * Turn rough into real (designs/2026-10-07-notes.md): the selected words, or the whole note, as
 * drafts in the workspace's Marketing. Tasks wait: there are none.
 */
import type { Editor } from "@tiptap/core";
import { say } from "@wren/ui";
import { call } from "../../api.js";
import { WREN } from "../../module.js";

/** The selected words, blocks apart; empty when nothing is selected. */
export function selectedWords(editor: Editor | null): string {
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return from === to ? "" : editor.state.doc.textBetween(from, to, "\n\n").trim();
}

const inWs = (client: string, body: Record<string, unknown>) =>
  client === WREN.id ? body : { client, ...body };

/** Drafts from the words, one per platform the workspace posts on. */
export function makeDrafts(client: string, id: string, text: string): void {
  call("notes/toDraft", inWs(client, { id, ...(text ? { text } : {}) }))
    .then(() =>
      say.done(
        text
          ? "Drafting from your selection. The drafts wait in Marketing → To approve."
          : "Drafting from this note. The drafts wait in Marketing → To approve.",
      ),
    )
    .catch(say.failed);
}
