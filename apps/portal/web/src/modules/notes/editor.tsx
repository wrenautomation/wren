/**
 * The note's editor: Tiptap over the note's Yjs doc, a toolbar, the `/` and `@` menus, find and
 * replace, links, and images pasted or dropped in. A version opens read-only in the same parts.
 */
import type { Editor, Range } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { NoteJson } from "@wren/notes/types";
import { cx, Icon, Input, say } from "@wren/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { ApiError } from "../../api.js";
import { navigate } from "../../route.js";
import { mentionHref, type NotePeople, notes } from "./api.js";
import { extensionsOf, FILE_SRC, find, type MenuItem, type Render, replace } from "./extensions.js";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Signed links last minutes: kept a little less. */
const SIGNED = new Map<string, { url: string; until: number }>();
export const resolverOf =
  (client: string, id: string) =>
  async (src: string): Promise<string> => {
    if (!src.startsWith(FILE_SRC)) return /^https:\/\//.test(src) ? src : "";
    const key = src.slice(FILE_SRC.length);
    const held = SIGNED.get(key);
    if (held && held.until > Date.now()) return held.url;
    const { url } = await notes(client, "file", { id, key }).catch(() => ({ url: "" }));
    if (url) SIGNED.set(key, { url, until: Date.now() + 4 * 60_000 });
    return url;
  };

/** Up to the bucket on a signed PUT; its `src` goes in the doc. */
async function uploadImage(client: string, id: string, file: File): Promise<string> {
  if (!IMAGE_TYPES.has(file.type)) throw new ApiError("Paste a PNG, JPEG, WebP or GIF.", 400);
  const up = await notes(client, "upload", {
    id,
    name: file.name,
    type: file.type,
    size: file.size,
  });
  const res = await fetch(up.url, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  }).catch(() => null);
  if (!res?.ok) throw new ApiError("The image didn't go up. Try again.", res?.status ?? 0);
  return up.src;
}

// ---- Menus (the `/` and `@` lists) -------------------------------------------------------------

interface Menu {
  items: MenuItem[];
  at: number;
  rect: DOMRect | null;
  pick: (i: MenuItem) => void;
}

/** Tiptap's suggestion callbacks, drawn by React: the menu's state lives in `set`. */
function menuRender(set: (m: Menu | null) => void, held: { current: Menu | null }): Render {
  return () => {
    const show = (p: {
      items: MenuItem[];
      clientRect?: (() => DOMRect | null) | null;
      command: (i: MenuItem) => void;
    }) => {
      const m: Menu = {
        items: p.items,
        at: Math.min(held.current?.at ?? 0, Math.max(0, p.items.length - 1)),
        rect: p.clientRect?.() ?? null,
        pick: p.command,
      };
      held.current = m;
      set(m);
    };
    return {
      onStart: (p) => {
        held.current = null;
        show(p);
      },
      onUpdate: show,
      onExit: () => {
        held.current = null;
        set(null);
      },
      onKeyDown: ({ event }) => {
        const m = held.current;
        if (!m?.items.length) return false;
        const n = m.items.length;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const at = (m.at + (event.key === "ArrowDown" ? 1 : -1) + n) % n;
          held.current = { ...m, at };
          set(held.current);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const i = m.items[m.at];
          if (i) m.pick(i);
          return true;
        }
        if (event.key === "Escape") {
          held.current = null;
          set(null);
          return true;
        }
        return false;
      },
    };
  };
}

function MenuList({ menu, label }: { menu: Menu | null; label: string }) {
  if (!menu?.rect || !menu.items.length) return null;
  const below = menu.rect.bottom + 280 < innerHeight;
  return (
    <div
      role="listbox"
      aria-label={label}
      className="fixed z-50 max-h-[272px] w-64 overflow-y-auto border border-(--ui-hair) bg-(--ui-paper) py-1 shadow-lg"
      style={{
        left: Math.max(8, Math.min(menu.rect.left, innerWidth - 264)),
        top: below ? menu.rect.bottom + 6 : undefined,
        bottom: below ? undefined : innerHeight - menu.rect.top + 6,
      }}
    >
      {menu.items.map((i, n) => (
        <button
          key={i.id}
          type="button"
          role="option"
          aria-selected={n === menu.at}
          onMouseDown={(e) => {
            e.preventDefault();
            menu.pick(i);
          }}
          className="flex w-full items-baseline justify-between gap-3 border-0 bg-transparent px-3 py-1.5 text-left text-[13.5px] text-(--ui-ink) aria-selected:bg-(--ui-accent-tint) hover:bg-(--ui-hover)"
        >
          <span className="min-w-0 truncate">{i.label}</span>
          {i.hint ? (
            <span className="flex-none text-[12px] text-(--ui-ink-2)">{i.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** A change suggest mode can't take: said once a few seconds, not on every key. */
let blockedAt = 0;
function blockedOnce() {
  if (Date.now() - blockedAt < 4000) return;
  blockedAt = Date.now();
  say.failed(
    new Error("Suggestions change words. Switch to Editing for new lines and formatting."),
  );
}

/** What `@` finds: people here, notes, and (at Wren) clients. */
function mentionSource(client: string, people: () => Promise<NotePeople | null>) {
  const put = (id: string, label: string) => (editor: Editor, range: Range) =>
    void editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: "mention", attrs: { id, label } },
        { type: "text", text: " " },
      ])
      .run();
  return async (q: string): Promise<MenuItem[]> => {
    const needle = q.toLowerCase();
    const [p, found] = await Promise.all([
      people(),
      notes(client, "home", { view: "all", q: q || undefined, limit: 6 }).catch(() => null),
    ]);
    const out: MenuItem[] = [];
    for (const x of p?.people ?? [])
      if (x.email.includes(needle))
        out.push({
          id: `person:${x.email}`,
          label: x.email,
          // Tagging doesn't share: someone who can't open it isn't told.
          hint: x.opens === false ? "Can't open it" : "Person",
          run: put(`person:${x.email}`, x.email),
        });
    for (const c of p?.clients ?? [])
      if (`${c.id} ${c.name}`.toLowerCase().includes(needle))
        out.push({
          id: `console.client:${c.id}`,
          label: c.name,
          hint: "Client",
          run: put(`console.client:${c.id}`, c.name),
        });
    for (const n of found?.notes ?? [])
      out.push({
        id: `note:${n.id}`,
        label: n.name,
        hint: "Note",
        run: put(`note:${n.id}`, n.name),
      });
    return out.slice(0, 10);
  };
}

// ---- Toolbar -----------------------------------------------------------------------------------

const TOOL =
  "inline-flex h-8 min-w-8 flex-none items-center justify-center border-0 bg-transparent px-1.5 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-pressed:bg-(--ui-accent-tint) aria-pressed:text-(--ui-ink) disabled:opacity-40 disabled:hover:bg-transparent";

function Tool({
  label,
  on,
  run,
  children,
  disabled,
}: {
  label: string;
  on?: boolean;
  run: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={TOOL}
      aria-label={label}
      title={label}
      aria-pressed={on ?? undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden="true" className="mx-1 h-5 w-px flex-none bg-(--ui-hair)" />;

const STYLES = [
  ["p", "Text"],
  ["1", "Heading 1"],
  ["2", "Heading 2"],
  ["3", "Heading 3"],
] as const;

/** Editing or suggesting: a menu for an editor, a fixed tag for a commenter. */
export interface Mode {
  suggesting: boolean;
  /** A commenter: suggesting only. */
  locked: boolean;
  set: (suggesting: boolean) => void;
}

function Toolbar({
  editor,
  onFind,
  onLink,
  onImage,
  onComment,
  mode,
}: {
  editor: Editor;
  onFind: () => void;
  onLink: () => void;
  onImage: (() => void) | null;
  onComment: (() => void) | null;
  mode: Mode | null;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...toolState(e),
      undo: e.can().undo(),
      redo: e.can().redo(),
      selected: !e.state.selection.empty,
    }),
  });
  const c = () => editor.chain().focus();
  const suggesting = !!mode?.suggesting;
  return (
    <div
      role="toolbar"
      aria-label="Format"
      className="flex min-h-10 items-center gap-0.5 overflow-x-auto border-b border-(--ui-hair) bg-(--ui-paper) px-2 print:hidden"
    >
      <Tool label="Undo (⌘Z)" run={() => c().undo().run()} disabled={!s.undo}>
        ↶
      </Tool>
      <Tool label="Redo (⇧⌘Z)" run={() => c().redo().run()} disabled={!s.redo}>
        ↷
      </Tool>
      <Sep />
      {suggesting ? (
        <span className="px-1.5 text-[12px] whitespace-nowrap text-(--ui-ink-2)">
          What you type and delete shows as a suggestion.
        </span>
      ) : (
        <Formats editor={editor} s={s} onLink={onLink} onImage={onImage} />
      )}
      <Sep />
      {onComment ? (
        <Tool label="Comment (⌘⌥M)" run={onComment} disabled={!s.selected}>
          <svg
            viewBox="0 0 16 16"
            width={16}
            height={16}
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinejoin="round"
          >
            <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          </svg>
        </Tool>
      ) : null}
      <Tool label="Find and replace (⌘F in a note)" run={onFind}>
        <Icon name="search" />
      </Tool>
      {mode ? (
        <span className="ml-auto flex-none pl-2">
          {mode.locked ? (
            <span className="text-[12px] text-(--ui-ink-2)">Suggesting</span>
          ) : (
            <select
              aria-label="Mode"
              value={mode.suggesting ? "suggest" : "edit"}
              onChange={(e) => mode.set(e.target.value === "suggest")}
              className="h-8 border-0 bg-transparent px-1 text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)"
            >
              <option value="edit">Editing</option>
              <option value="suggest">Suggesting</option>
            </select>
          )}
        </span>
      ) : null}
    </div>
  );
}

type ToolState = ReturnType<typeof toolState>;
function toolState(e: Editor) {
  return {
    style: e.isActive("heading", { level: 1 })
      ? "1"
      : e.isActive("heading", { level: 2 })
        ? "2"
        : e.isActive("heading", { level: 3 })
          ? "3"
          : "p",
    bold: e.isActive("bold"),
    italic: e.isActive("italic"),
    underline: e.isActive("underline"),
    strike: e.isActive("strike"),
    code: e.isActive("code"),
    link: e.isActive("link"),
    bullet: e.isActive("bulletList"),
    ordered: e.isActive("orderedList"),
    task: e.isActive("taskList"),
    quote: e.isActive("blockquote"),
    codeBlock: e.isActive("codeBlock"),
    table: e.isActive("table"),
  };
}

/** Styles, marks, blocks, tables and images: editing only (a suggestion is words). */
function Formats({
  editor,
  s,
  onLink,
  onImage,
}: {
  editor: Editor;
  s: ToolState;
  onLink: () => void;
  onImage: (() => void) | null;
}) {
  const c = () => editor.chain().focus();
  return (
    <>
      <select
        aria-label="Text style"
        value={s.style}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") c().setParagraph().run();
          else
            c()
              .setHeading({ level: Number(v) as 1 | 2 | 3 })
              .run();
        }}
        className="h-8 flex-none border-0 bg-transparent px-1 text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)"
      >
        {STYLES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Sep />
      <Tool label="Bold (⌘B)" on={s.bold} run={() => c().toggleBold().run()}>
        <b>B</b>
      </Tool>
      <Tool label="Italic (⌘I)" on={s.italic} run={() => c().toggleItalic().run()}>
        <i>I</i>
      </Tool>
      <Tool label="Underline (⌘U)" on={s.underline} run={() => c().toggleUnderline().run()}>
        <u>U</u>
      </Tool>
      <Tool label="Strikethrough" on={s.strike} run={() => c().toggleStrike().run()}>
        <s>S</s>
      </Tool>
      <Tool label="Code" on={s.code} run={() => c().toggleCode().run()}>
        <span className="font-mono text-[12px]">{"<>"}</span>
      </Tool>
      <Tool label="Link (⌘K in a note)" on={s.link} run={onLink}>
        <Icon name="link" />
      </Tool>
      <Sep />
      <Tool label="Bulleted list" on={s.bullet} run={() => c().toggleBulletList().run()}>
        •
      </Tool>
      <Tool label="Numbered list" on={s.ordered} run={() => c().toggleOrderedList().run()}>
        1.
      </Tool>
      <Tool label="Checklist" on={s.task} run={() => c().toggleTaskList().run()}>
        <Icon name="check" />
      </Tool>
      <Tool label="Quote" on={s.quote} run={() => c().toggleBlockquote().run()}>
        ”
      </Tool>
      <Tool label="Code block" on={s.codeBlock} run={() => c().toggleCodeBlock().run()}>
        <span className="font-mono text-[12px]">{"{}"}</span>
      </Tool>
      <Tool label="Divider" run={() => c().setHorizontalRule().run()}>
        <svg
          viewBox="0 0 16 16"
          width={16}
          height={16}
          aria-hidden="true"
          stroke="currentColor"
          strokeWidth={1.4}
        >
          <path d="M2.5 8h11" />
        </svg>
      </Tool>
      <Sep />
      <Tool
        label="Table"
        on={s.table}
        run={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Icon name="board" />
      </Tool>
      {s.table ? (
        <>
          <Tool label="Add a row" run={() => c().addRowAfter().run()}>
            +R
          </Tool>
          <Tool label="Add a column" run={() => c().addColumnAfter().run()}>
            +C
          </Tool>
          <Tool label="Delete the row" run={() => c().deleteRow().run()}>
            −R
          </Tool>
          <Tool label="Delete the column" run={() => c().deleteColumn().run()}>
            −C
          </Tool>
          <Tool label="Delete the table" run={() => c().deleteTable().run()}>
            <Icon name="close" />
          </Tool>
        </>
      ) : null}
      {onImage ? (
        <Tool label="Image" run={onImage}>
          <svg
            viewBox="0 0 16 16"
            width={16}
            height={16}
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinejoin="round"
          >
            <path d="M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3" />
          </svg>
        </Tool>
      ) : null}
    </>
  );
}

// ---- Bars under the toolbar --------------------------------------------------------------------

function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [by, setBy] = useState("");
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => () => void find(editor, ""), [editor]);
  const go = (step: number) => setPos(find(editor, q, step));
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-(--ui-hair) bg-(--ui-tile) px-3 py-2 text-[13px] print:hidden">
      <Input
        ref={box}
        value={q}
        aria-label="Find"
        placeholder="Find"
        className="h-8 w-44 rounded-none"
        onChange={(e) => {
          setQ(e.target.value);
          setPos(find(editor, e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="w-14 text-(--ui-ink-2)" aria-live="polite">
        {q ? `${pos[0]} of ${pos[1]}` : ""}
      </span>
      <button type="button" className={TOOL} aria-label="Previous match" onClick={() => go(-1)}>
        <Icon name="left" />
      </button>
      <button type="button" className={TOOL} aria-label="Next match" onClick={() => go(1)}>
        <Icon name="right" />
      </button>
      {editor.isEditable ? (
        <>
          <Input
            value={by}
            aria-label="Replace with"
            placeholder="Replace with"
            className="h-8 w-44 rounded-none"
            onChange={(e) => setBy(e.target.value)}
          />
          <button
            type="button"
            className={TOOL}
            onClick={() => {
              replace(editor, q, by, false);
              setPos(find(editor, q));
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className={TOOL}
            onClick={() => {
              replace(editor, q, by, true);
              setPos(find(editor, q));
            }}
          >
            Replace all
          </button>
        </>
      ) : null}
      <button
        type="button"
        className={cx(TOOL, "ml-auto")}
        aria-label="Close find"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [url, setUrl] = useState(String(editor.getAttributes("link").href ?? ""));
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const save = () => {
    const u = url.trim();
    const c = editor.chain().focus().extendMarkRange("link");
    if (!u) c.unsetLink().run();
    else {
      const href = /^(https?:|mailto:|\/)/.test(u) ? u : `https://${u}`;
      if (editor.state.selection.empty && !editor.isActive("link"))
        c.insertContent({
          type: "text",
          text: u,
          marks: [{ type: "link", attrs: { href } }],
        }).run();
      else c.setLink({ href }).run();
    }
    onClose();
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b border-(--ui-hair) bg-(--ui-tile) px-3 py-2 text-[13px] print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        ref={box}
        value={url}
        aria-label="Link"
        placeholder="Paste a link, or a note's address"
        className="h-8 w-72 max-w-full rounded-none"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      />
      <button type="submit" className={TOOL}>
        {url.trim() ? "Apply" : "Remove link"}
      </button>
      <button type="button" className={cx(TOOL, "ml-auto")} aria-label="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </form>
  );
}

// ---- The editor --------------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
  pos: number;
}

/** The doc's headings, for the outline. */
export function outlineOf(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "heading")
      out.push({ level: Number(n.attrs.level), text: n.textContent, pos });
    return n.isBlock && n.type.name !== "heading";
  });
  return out;
}

export const wordsIn = (editor: Editor) =>
  (
    editor.state.doc
      .textBetween(0, editor.state.doc.content.size, " ", " ")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).length;

/** Plain clicks on a mention open it; on a link, ⌘-click while editing, any click reading. */
function onLinkClick(e: React.MouseEvent, editable: boolean) {
  const t = e.target as HTMLElement;
  const mention = t.closest<HTMLElement>("[data-type=mention]");
  if (mention) {
    const to = mentionHref(mention.dataset.id ?? "");
    if (to) {
      e.preventDefault();
      navigate(to);
    }
    return;
  }
  const a = t.closest("a[href]");
  if (!(a instanceof HTMLAnchorElement) || (editable && !(e.metaKey || e.ctrlKey))) return;
  e.preventDefault();
  const to = new URL(a.href, location.href);
  if (to.origin === location.origin) navigate(to.pathname + to.search);
  else open(to.href, "_blank", "noopener");
}

export function NoteEditor({
  client,
  id,
  doc,
  editable,
  people,
  onEditor,
  live,
  mode,
  onComment,
  onPickComment,
}: {
  client: string;
  id: string;
  doc: Y.Doc;
  editable: boolean;
  people: () => Promise<NotePeople | null>;
  onEditor: (e: Editor | null) => void;
  /** Others' cursors, and who this is. */
  live: { awareness: Awareness; me: string } | null;
  /** Editing or suggesting; null when this person can't suggest. */
  mode: Mode | null;
  onComment: (() => void) | null;
  onPickComment: (id: string) => void;
}) {
  // The editor is made once per doc: what it asks later reads these.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pickRef = useRef(onPickComment);
  pickRef.current = onPickComment;
  const commentRef = useRef(onComment);
  commentRef.current = onComment;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [mention, setMention] = useState<Menu | null>(null);
  const [bar, setBar] = useState<"find" | "link" | null>(null);
  const heldMenu = useRef<Menu | null>(null);
  const heldMention = useRef<Menu | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const resolve = useMemo(() => resolverOf(client, id), [client, id]);
  const editorRef = useRef<Editor | null>(null);

  const putImages = async (files: File[], at?: number) => {
    const e = editorRef.current;
    if (!e) return;
    for (const f of files) {
      try {
        const src = await uploadImage(client, id, f);
        const chain = e.chain().focus();
        (at !== undefined
          ? chain.insertContentAt(at, { type: "image", attrs: { src, alt: f.name } })
          : chain.setImage({ src, alt: f.name })
        ).run();
      } catch (err) {
        say.failed(err);
      }
    }
  };

  const editor = useEditor(
    {
      extensions: extensionsOf({
        doc,
        resolve,
        slash: menuRender(setMenu, heldMenu),
        image: () => picker.current?.click(),
        mention: {
          items: mentionSource(client, people),
          render: menuRender(setMention, heldMention),
        },
        placeholder: "Write here. Type / for blocks, @ to link a person, note or client.",
        live: live ?? undefined,
        suggest: live
          ? {
              by: live.me,
              on: () => !!modeRef.current?.suggesting,
              onBlocked: blockedOnce,
            }
          : undefined,
        comments: { onPick: (c) => pickRef.current(c) },
      }),
      editable,
      injectCSS: false,
      editorProps: {
        attributes: { class: "note-body", "aria-label": "Note", spellcheck: "true" },
        handlePaste: (_v, event) => {
          const files = [...(event.clipboardData?.files ?? [])].filter((f) =>
            IMAGE_TYPES.has(f.type),
          );
          if (!files.length) return false;
          void putImages(files);
          return true;
        },
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files ?? [])].filter((f) =>
            IMAGE_TYPES.has(f.type),
          );
          if (!files.length) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void putImages(files, at);
          return true;
        },
        handleKeyDown: (_v, event) => {
          if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyM") {
            event.preventDefault();
            commentRef.current?.();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            setBar("find");
            return true;
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "k" &&
            editorRef.current?.isEditable
          ) {
            // ⌘K is the palette everywhere else; in a note, a link, as in Docs.
            event.preventDefault();
            event.stopPropagation();
            setBar("link");
            return true;
          }
          return false;
        },
      },
    },
    [doc],
  );
  editorRef.current = editor;
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;
  return (
    <div className="flex min-w-0 flex-col">
      {editable ? (
        <div className="sticky top-0 z-10">
          <Toolbar
            editor={editor}
            onFind={() => setBar(bar === "find" ? null : "find")}
            onLink={() => setBar(bar === "link" ? null : "link")}
            onImage={() => picker.current?.click()}
            onComment={onComment}
            mode={mode}
          />
          {bar === "find" ? <FindBar editor={editor} onClose={() => setBar(null)} /> : null}
          {bar === "link" ? <LinkBar editor={editor} onClose={() => setBar(null)} /> : null}
        </div>
      ) : bar === "find" ? (
        <FindBar editor={editor} onClose={() => setBar(null)} />
      ) : null}
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          void putImages([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: links inside the editor open from here. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the editor's own keys move through links. */}
      <div className="note-paper" onClick={(e) => onLinkClick(e, editor.isEditable)}>
        <EditorContent editor={editor} />
      </div>
      <MenuList menu={menu} label="Blocks" />
      <MenuList menu={mention} label="Link to" />
    </div>
  );
}

/** A version, or anything kept as JSON: the same look, read only. */
export function NoteView({ client, id, json }: { client: string; id: string; json: NoteJson }) {
  const resolve = useMemo(() => resolverOf(client, id), [client, id]);
  const editor = useEditor(
    {
      extensions: extensionsOf({ resolve }),
      content: json as never,
      editable: false,
      injectCSS: false,
      editorProps: { attributes: { class: "note-body", "aria-label": "Version" } },
    },
    [json],
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: links inside open from here.
    // biome-ignore lint/a11y/useKeyWithClickEvents: links are reached by their own keys.
    <div onClick={(e) => onLinkClick(e, false)}>
      <EditorContent editor={editor} />
    </div>
  );
}
