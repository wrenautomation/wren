/**
 * A pasted link to a file in Drive, Sheets, Dropbox or OneDrive becomes a link chip: its kind as
 * the words, then (Google files) the file's name once Drive has said it. Anything else pastes as
 * it always did.
 */

import type { EditorView } from "@tiptap/pm/view";
import { type FileLink, fileLinkOf } from "@wren/notes/sheet";
import { notes } from "./api.js";

const GOOGLE = new Set<FileLink["kind"]>(["doc", "sheet", "slides", "drive"]);

/** Put the chip where the cursor is; true when the paste was a file link and is handled. */
export function pasteFileLink(view: EditorView, client: string, text: string): boolean {
  const t = text.trim();
  const kind = t && !/\s/.test(t) ? fileLinkOf(t) : null;
  const link = view.state.schema.marks.link;
  if (!kind || !link) return false;
  const mark = link.create({ href: t });
  view.dispatch(
    view.state.tr.replaceSelectionWith(view.state.schema.text(kind.label, [mark]), false),
  );
  if (GOOGLE.has(kind.kind))
    void notes(client, "driveTitle", { link: t })
      .then(({ title }) => title && rename(view, t, kind.label, title))
      .catch(() => {});
  return true;
}

/** The chip's words become the file's name, wherever the chip is now. */
function rename(view: EditorView, href: string, was: string, title: string) {
  if (view.isDestroyed) return;
  const { state } = view;
  const found: { pos: number; size: number; marks: readonly never[] }[] = [];
  state.doc.descendants((n, pos) => {
    if (
      n.isText &&
      n.text === was &&
      n.marks.some((m) => m.type.name === "link" && m.attrs.href === href)
    )
      found.push({ pos, size: n.nodeSize, marks: n.marks as never });
  });
  if (!found.length) return;
  const tr = state.tr;
  for (const f of found.reverse())
    tr.replaceWith(f.pos, f.pos + f.size, state.schema.text(title, f.marks as never));
  view.dispatch(tr);
}
