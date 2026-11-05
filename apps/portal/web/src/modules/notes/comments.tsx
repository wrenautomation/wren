/**
 * Comments and suggestions, the side panel (designs/2026-10-07-notes.md, batch 2). A comment
 * holds on to the words it was made on by Yjs relative positions, kept with the comment, not in
 * the doc, so a commenter never writes to the note and the words can move as others type. The
 * highlight is a decoration drawn from those positions.
 */
import type { Editor } from "@tiptap/core";
import {
  absolutePositionToRelativePosition,
  type relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { Y_BODY } from "@wren/notes/types";
import { Button } from "@wren/ui";
import { type RefObject, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { NoteComments, NotePeople } from "./api.js";

export type Thread = NoteComments["threads"][number];
export interface Anchor {
  from: unknown;
  to: unknown;
}

type Mapping = Parameters<typeof relativePositionToAbsolutePosition>[3];

function bindingOf(state: Parameters<typeof ySyncPluginKey.getState>[0]) {
  const s = ySyncPluginKey.getState(state) as
    | { doc: Y.Doc; binding: { mapping: Mapping } | null }
    | undefined;
  return s?.binding ? { doc: s.doc, mapping: s.binding.mapping } : null;
}

/** The selection as an anchor, with the words it covers. Null when nothing is selected. */
export function anchorOf(editor: Editor): { anchor: Anchor; quote: string } | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const b = bindingOf(editor.state);
  if (!b) return null;
  const type = b.doc.getXmlFragment(Y_BODY);
  const rel = (pos: number) =>
    Y.relativePositionToJSON(absolutePositionToRelativePosition(pos, type, b.mapping));
  return {
    anchor: { from: rel(from), to: rel(to) },
    quote: editor.state.doc.textBetween(from, to, " ", " ").slice(0, 500),
  };
}

// ---- The panel ---------------------------------------------------------------------------------

const FIELD =
  "w-full resize-y border border-(--ui-hair) bg-(--ui-paper) px-2 py-1.5 text-[13px] text-(--ui-ink) outline-none focus-visible:border-(--ui-focus)";

/**
 * A text box where `@` offers the people here, and inserts their email. The Inbox's note box is
 * this one too (designs/2026-10-07-inbox-reply.md).
 */
export function Compose({
  people,
  placeholder,
  initial = "",
  busy,
  submit,
  onCancel,
  autoFocus,
  button,
  box: outer,
}: {
  people: () => Promise<NotePeople | null>;
  placeholder: string;
  initial?: string;
  busy: boolean;
  submit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** The submit button's word: "Comment" (or "Save" when editing) when left out. */
  button?: string;
  /** The text box, for a caller that focuses it (a key). */
  box?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState(initial);
  const [list, setList] = useState<NotePeople["people"]>([]);
  const [q, setQ] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const own = useRef<HTMLTextAreaElement>(null);
  const box = outer ?? own;
  const choosing = q !== null && list.length > 0;
  // read-ok: `people` is the note's cached read (`readCall`); this filters it as `@` is typed.
  useEffect(() => {
    if (q === null) return;
    let live = true;
    void people().then((p) => {
      if (!live) return;
      const needle = q.toLowerCase();
      setList((p?.people ?? []).filter((x) => x.email.includes(needle)).slice(0, 6));
      setHi(0);
    });
    return () => {
      live = false;
    };
  }, [q, people]);
  const read = (v: string, at: number) => {
    const m = /(?:^|\s)@([^\s@]*)$/.exec(v.slice(0, at));
    setQ(m ? (m[1] ?? "") : null);
  };
  const pick = (email: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at).replace(/@[^\s@]*$/, `@${email} `);
    const next = before + text.slice(at);
    setText(next);
    setQ(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    if (await submit(text.trim())) setText("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={box}
        value={text}
        rows={2}
        maxLength={10_000}
        placeholder={placeholder}
        aria-label={placeholder}
        // biome-ignore lint/a11y/noAutofocus: opened by the person to write in.
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          read(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          // The people list takes the arrows, Enter and Tab while it's open.
          if (choosing && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            const n = list.length;
            setHi((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            return;
          }
          if (choosing && (e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const p = list[hi] ?? list[0];
            if (p) pick(p.email);
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === "Escape") {
            if (q !== null) setQ(null);
            else onCancel?.();
          }
        }}
        className={FIELD}
      />
      {choosing ? (
        <ul aria-label="People" className="m-0 list-none border border-(--ui-hair) p-0">
          {list.map((p, i) => (
            <li key={p.email}>
              <button
                type="button"
                aria-current={i === hi ? "true" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.email)}
                className="w-full wrap-anywhere whitespace-normal border-0 bg-transparent px-2 py-1 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:bg-(--ui-hover)"
              >
                {p.email}
                {p.opens === false ? (
                  <span className="text-(--ui-ink-2)"> · Can't open it</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          tone="primary"
          size="dense"
          disabled={!text.trim() || busy}
          onClick={() => void send()}
        >
          {button ?? (initial ? "Save" : "Comment")}
        </Button>
        {onCancel ? (
          <Button size="dense" tone="quiet" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <span className="ml-auto text-[11px] text-(--ui-ink-3)">@ to tag someone</span>
      </div>
    </div>
  );
}
