/**
 * The editor's parts: Tiptap's blocks (the schema the server's converter writes, in
 * `@wren/notes/doc`), plus ours: find and replace, the `/` menu, and images kept in the files
 * bucket under `wren-file:<key>`, shown through a signed link.
 */
import { type AnyExtension, type Editor, Extension, type Range } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Mention from "@tiptap/extension-mention";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { Y_BODY } from "@wren/notes/types";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { hueClass } from "./api.js";
import { CommentMarks } from "./comments.js";
import { SuggestAdd, SuggestDel, Suggesting } from "./suggesting.js";

export const FILE_SRC = "wren-file:";

export type Render = NonNullable<SuggestionOptions["render"]>;

/** One line of the `/` menu or the `@` menu. */
export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  run: (editor: Editor, range: Range) => void;
}

// ---- Find and replace --------------------------------------------------------------------------

interface FindState {
  q: string;
  at: number;
  hits: { from: number; to: number }[];
  decos: DecorationSet;
}
export const FIND = new PluginKey<FindState>("find");

function hitsOf(doc: PmNode, q: string) {
  const hits: { from: number; to: number }[] = [];
  if (!q) return hits;
  const needle = q.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = node.text.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length))
      hits.push({ from: pos + i, to: pos + i + needle.length });
  });
  return hits;
}

const Find = Extension.create({
  name: "find",
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: FIND,
        state: {
          init: () => ({ q: "", at: 0, hits: [], decos: DecorationSet.empty }),
          apply(tr, old) {
            const meta = tr.getMeta(FIND) as { q?: string; at?: number } | undefined;
            if (!meta && !tr.docChanged) return old;
            const q = meta?.q ?? old.q;
            const hits = hitsOf(tr.doc, q);
            const at = hits.length ? Math.max(0, Math.min(meta?.at ?? old.at, hits.length - 1)) : 0;
            const decos = DecorationSet.create(
              tr.doc,
              hits.map((h, i) =>
                Decoration.inline(h.from, h.to, {
                  class: i === at ? "note-hit note-hit-on" : "note-hit",
                }),
              ),
            );
            return { q, at, hits, decos };
          },
        },
        props: { decorations: (state) => FIND.getState(state)?.decos ?? null },
      }),
    ];
  },
});

/** Look for `q`; `step` moves to the next (1) or the one before (-1). Answers [which, of]. */
export function find(editor: Editor, q: string, step = 0): [number, number] {
  const old = FIND.getState(editor.state);
  const n = old && old.q === q ? old.hits.length : hitsOf(editor.state.doc, q).length;
  const at = n ? ((((old?.q === q ? old.at : 0) + step) % n) + n) % n : 0;
  editor.view.dispatch(editor.state.tr.setMeta(FIND, { q, at }));
  const hit = FIND.getState(editor.state)?.hits[at];
  if (hit) editor.view.domAtPos(hit.from).node.parentElement?.scrollIntoView({ block: "center" });
  return [n ? at + 1 : 0, n];
}

/** Replace the current hit, or every one. */
export function replace(editor: Editor, q: string, by: string, all: boolean) {
  const s = FIND.getState(editor.state);
  if (!s || s.q !== q || !s.hits.length) return;
  const hits = all ? s.hits : [s.hits[s.at] as { from: number; to: number }];
  const tr = editor.state.tr;
  for (const h of [...hits].reverse())
    by ? tr.insertText(by, h.from, h.to) : tr.delete(h.from, h.to);
  editor.view.dispatch(tr.setMeta(FIND, { q, at: s.at }));
}

// ---- The `/` menu --------------------------------------------------------------------------------

const block = (label: string, hint: string, run: (c: ReturnType<Editor["chain"]>) => unknown) => ({
  id: label,
  label,
  hint,
  run: (editor: Editor, range: Range) => void run(editor.chain().focus().deleteRange(range)),
});

export const BLOCKS: MenuItem[] = [
  block("Text", "Plain words", (c) => c.setParagraph().run()),
  block("Heading 1", "#", (c) => c.setHeading({ level: 1 }).run()),
  block("Heading 2", "##", (c) => c.setHeading({ level: 2 }).run()),
  block("Heading 3", "###", (c) => c.setHeading({ level: 3 }).run()),
  block("Bulleted list", "-", (c) => c.toggleBulletList().run()),
  block("Numbered list", "1.", (c) => c.toggleOrderedList().run()),
  block("Checklist", "[ ]", (c) => c.toggleTaskList().run()),
  block("Quote", ">", (c) => c.toggleBlockquote().run()),
  block("Code", "```", (c) => c.toggleCodeBlock().run()),
  block("Divider", "---", (c) => c.setHorizontalRule().run()),
  block("Table", "3 by 3", (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
];

const Slash = Extension.create<{ render: Render | null; image: (() => void) | null }>({
  name: "slash",
  addOptions: () => ({ render: null, image: null }),
  addProseMirrorPlugins() {
    const image = this.options.image;
    const items: MenuItem[] = image
      ? [
          ...BLOCKS,
          {
            id: "Image",
            label: "Image",
            hint: "Upload",
            run: (editor, range) => {
              editor.chain().focus().deleteRange(range).run();
              image();
            },
          },
        ]
      : BLOCKS;
    return [
      Suggestion<MenuItem, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slash"),
        char: "/",
        items: ({ query }) =>
          items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())).slice(0, 12),
        command: ({ editor, range, props }) => props.run(editor, range),
        allow: ({ editor }) => !editor.isActive("codeBlock"),
        ...(this.options.render ? { render: this.options.render } : {}),
      }),
    ];
  },
});

// ---- Images ----------------------------------------------------------------------------------

/** An image whose `src` may be a file of ours: its signed link is asked for, then shown. */
const NoteImage = Image.extend<
  { resolve: (src: string) => Promise<string> } & Record<string, unknown>
>({
  addOptions() {
    return { ...this.parent?.(), resolve: async (s: string) => s } as never;
  },
  addNodeView() {
    const resolve = (this.options as unknown as { resolve: (s: string) => Promise<string> })
      .resolve;
    return ({ node }) => {
      const img = document.createElement("img");
      img.className = "note-image";
      let src = "";
      const show = (n: PmNode) => {
        img.alt = String(n.attrs.alt ?? "");
        if (n.attrs.src === src) return;
        src = String(n.attrs.src ?? "");
        img.removeAttribute("src");
        void resolve(src).then((u) => {
          if (src === n.attrs.src) img.src = u;
        });
      };
      show(node);
      return {
        dom: img,
        update: (n: PmNode) => {
          if (n.type !== node.type) return false;
          show(n);
          return true;
        },
      };
    };
  },
});

// ---- All of it -------------------------------------------------------------------------------

export function extensionsOf(o: {
  doc?: Y.Doc | undefined;
  resolve: (src: string) => Promise<string>;
  slash?: Render | undefined;
  image?: (() => void) | undefined;
  mention?: { items: (q: string) => Promise<MenuItem[]>; render: Render } | undefined;
  placeholder?: string | undefined;
  /** Others' cursors, from the live room; `me` is this person's email. */
  live?: { awareness: Awareness; me: string } | undefined;
  /** Suggest mode: on when this says so. */
  suggest?: { by: string; on: () => boolean; onBlocked: () => void } | undefined;
  /** Comments' highlights; a click picks the thread. */
  comments?: { onPick: (id: string) => void } | undefined;
}): AnyExtension[] {
  return [
    StarterKit.configure({
      // Yjs keeps undo when the doc is shared: its undo skips others' edits.
      ...(o.doc ? { undoRedo: false } : {}),
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    NoteImage.configure({ resolve: o.resolve, allowBase64: false } as never),
    Mention.configure({
      HTMLAttributes: { class: "note-mention" },
      renderText: ({ node }: { node: { attrs: { label?: string; id?: string } } }) =>
        `@${node.attrs.label ?? node.attrs.id}`,
      ...(o.mention
        ? {
            suggestion: {
              char: "@",
              items: ({ query }: { query: string }) =>
                (o.mention as NonNullable<typeof o.mention>).items(query),
              command: ({
                editor,
                range,
                props,
              }: {
                editor: Editor;
                range: Range;
                props: MenuItem;
              }) => props.run(editor, range),
              render: o.mention.render,
            },
          }
        : {}),
    } as never),
    Placeholder.configure({ placeholder: o.placeholder ?? "" }),
    Find,
    ...(o.slash || o.image
      ? [Slash.configure({ render: o.slash ?? null, image: o.image ?? null })]
      : []),
    SuggestAdd,
    SuggestDel,
    ...(o.suggest ? [Suggesting.configure(o.suggest)] : []),
    ...(o.comments ? [CommentMarks.configure(o.comments)] : []),
    ...(o.doc ? [Collaboration.configure({ document: o.doc, field: Y_BODY })] : []),
    ...(o.doc && o.live
      ? [
          CollaborationCaret.configure({
            provider: { awareness: o.live.awareness },
            user: { email: o.live.me, name: o.live.me },
            render: caret,
            selectionRender: (user: Record<string, unknown>) => ({
              nodeName: "span",
              class: `collaboration-carets__selection ${hueClass(String(user.email ?? ""))}`,
            }),
          }),
        ]
      : []),
  ];
}

/**
 * Someone else's cursor: a bar in their hue with their email, as the room signed them in. A class
 * per hue, since the portal's CSP takes no inline style here.
 */
function caret(user: Record<string, unknown>): HTMLElement {
  const email = String(user.email ?? "");
  const bar = document.createElement("span");
  bar.className = `collaboration-carets__caret ${hueClass(email)}`;
  const label = document.createElement("span");
  label.className = "collaboration-carets__label";
  label.textContent = email.split("@")[0] ?? email;
  label.title = email;
  bar.append(label);
  return bar;
}
