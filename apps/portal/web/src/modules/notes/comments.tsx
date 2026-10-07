/**
 * Comments and suggestions, the side panel (designs/2026-10-07-notes.md, batch 2). A comment
 * holds on to the words it was made on by Yjs relative positions, kept with the comment, not in
 * the doc, so a commenter never writes to the note and the words can move as others type. The
 * highlight is a decoration drawn from those positions.
 */
import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { Y_BODY } from "@wren/notes/types";
import { Button, Icon, relative, say } from "@wren/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { hueOf, type NoteComments, type NotePeople, notes } from "./api.js";
import { resolveSuggestions, type Suggestion, suggestionsIn } from "./suggesting.js";

export type Thread = NoteComments["threads"][number];
export interface Anchor {
  from: unknown;
  to: unknown;
}

// ---- The highlights ------------------------------------------------------------------------------

interface Marks {
  threads: { id: string; anchor: Anchor | null }[];
  active: string | null;
  decos: DecorationSet;
}
export const COMMENTS = new PluginKey<Marks>("comments");

type Mapping = Parameters<typeof relativePositionToAbsolutePosition>[3];

function bindingOf(state: Parameters<typeof ySyncPluginKey.getState>[0]) {
  const s = ySyncPluginKey.getState(state) as
    | { doc: Y.Doc; binding: { mapping: Mapping } | null }
    | undefined;
  return s?.binding ? { doc: s.doc, mapping: s.binding.mapping } : null;
}

/** Where an anchor's words are now, or null once they're gone. */
function rangeOf(state: Parameters<typeof ySyncPluginKey.getState>[0], a: Anchor | null) {
  const b = bindingOf(state);
  if (!b || !a) return null;
  const type = b.doc.getXmlFragment(Y_BODY);
  try {
    const from = relativePositionToAbsolutePosition(
      b.doc,
      type,
      Y.createRelativePositionFromJSON(a.from),
      b.mapping,
    );
    const to = relativePositionToAbsolutePosition(
      b.doc,
      type,
      Y.createRelativePositionFromJSON(a.to),
      b.mapping,
    );
    return from !== null && to !== null && to > from ? { from, to } : null;
  } catch {
    return null;
  }
}

function decosOf(state: Parameters<typeof ySyncPluginKey.getState>[0], m: Marks, doc: PmNode) {
  const out: Decoration[] = [];
  for (const t of m.threads) {
    const r = rangeOf(state, t.anchor);
    if (r)
      out.push(
        Decoration.inline(r.from, r.to, {
          class: t.id === m.active ? "note-comment note-comment-on" : "note-comment",
          "data-comment": t.id,
        }),
      );
  }
  return DecorationSet.create(doc, out);
}

/** The highlights; a click on one opens its thread. */
export const CommentMarks = Extension.create<{ onPick: (id: string) => void }>({
  name: "commentMarks",
  addOptions: () => ({ onPick: () => {} }),
  addProseMirrorPlugins() {
    const { onPick } = this.options;
    return [
      new Plugin<Marks>({
        key: COMMENTS,
        state: {
          init: () => ({ threads: [], active: null, decos: DecorationSet.empty }),
          apply(tr, old, _o, state) {
            const meta = tr.getMeta(COMMENTS) as Partial<Marks> | undefined;
            if (!meta && !tr.docChanged) return old;
            const next = { ...old, ...meta };
            return { ...next, decos: decosOf(state, next, state.doc) };
          },
        },
        props: {
          decorations: (state) => COMMENTS.getState(state)?.decos ?? null,
          handleClick: (_view, _pos, event) => {
            const hit = (event.target as HTMLElement | null)?.closest?.("[data-comment]");
            const id = hit?.getAttribute("data-comment");
            if (id) onPick(id);
            return false;
          },
        },
      }),
    ];
  },
});

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

/** Show these threads' highlights, `active` stronger. */
export function showThreads(editor: Editor, threads: Thread[], active: string | null) {
  const tr = editor.state.tr.setMeta(COMMENTS, {
    threads: threads.filter((t) => !t.resolvedAt).map((t) => ({ id: t.id, anchor: t.anchor })),
    active,
  });
  editor.view.dispatch(tr);
}

/** Scroll to a thread's words. */
export function goTo(editor: Editor, t: Thread) {
  const r = rangeOf(editor.state, t.anchor as Anchor | null);
  if (!r) return;
  const dom = editor.view.domAtPos(r.from).node;
  (dom instanceof HTMLElement ? dom : dom.parentElement)?.scrollIntoView({
    block: "center",
    behavior: "smooth",
  });
}

// ---- The panel ---------------------------------------------------------------------------------

const FIELD =
  "w-full resize-y border border-(--ui-hair) bg-(--ui-paper) px-2 py-1.5 text-[13px] text-(--ui-ink) outline-none focus:border-(--ui-accent)";

/** A text box where `@` offers the people here, and inserts their email. */
function Compose({
  people,
  placeholder,
  initial = "",
  busy,
  submit,
  onCancel,
  autoFocus,
}: {
  people: () => Promise<NotePeople | null>;
  placeholder: string;
  initial?: string;
  busy: boolean;
  submit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [list, setList] = useState<NotePeople["people"]>([]);
  const [q, setQ] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (q === null) return;
    let live = true;
    void people().then((p) => {
      if (!live) return;
      const needle = q.toLowerCase();
      setList((p?.people ?? []).filter((x) => x.email.includes(needle)).slice(0, 6));
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
      {q !== null && list.length ? (
        <ul aria-label="People" className="m-0 list-none border border-(--ui-hair) p-0">
          {list.map((p) => (
            <li key={p.email}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.email)}
                className="w-full truncate border-0 bg-transparent px-2 py-1 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)"
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
        <Button size="dense" disabled={!text.trim() || busy} onClick={() => void send()}>
          {initial ? "Save" : "Comment"}
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

function Who({ email, at, edited }: { email: string; at: string; edited?: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-(--ui-ink-2)">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 flex-none rounded-full"
        style={{ background: hueOf(email) }}
      />
      <span className="truncate font-medium text-(--ui-ink)">{email}</span>
      <span className="flex-none">
        {relative(new Date(at))}
        {edited ? " · edited" : ""}
      </span>
    </span>
  );
}

const LINK =
  "border-0 bg-transparent p-0 text-[12px] text-(--ui-ink-2) underline-offset-2 hover:text-(--ui-ink) hover:underline";

function One({
  c,
  client,
  noteId,
  owner,
  onChanged,
  people,
}: {
  c: Thread | Thread["replies"][number];
  client: string;
  noteId: string;
  owner: boolean;
  onChanged: () => void;
  people: () => Promise<NotePeople | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (editing)
    return (
      <Compose
        people={people}
        placeholder="Edit the comment"
        initial={c.body}
        busy={busy}
        autoFocus
        onCancel={() => setEditing(false)}
        submit={async (body) => {
          setBusy(true);
          try {
            await notes(client, "commentEdit", { id: noteId, commentId: c.id, body });
            setEditing(false);
            onChanged();
            return true;
          } catch (err) {
            say.failed(err);
            return false;
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  return (
    <div className="flex flex-col gap-1">
      <Who email={c.by} at={c.at} edited={c.editedAt} />
      <p className="m-0 text-[13px] break-words whitespace-pre-wrap text-(--ui-ink)">{c.body}</p>
      {c.mine || owner ? (
        <span className="flex gap-3">
          {c.mine ? (
            <button type="button" className={LINK} onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
          <button
            type="button"
            className={LINK}
            onClick={() => {
              if (!confirm("Delete this comment?")) return;
              void notes(client, "commentDelete", { id: noteId, commentId: c.id })
                .then(onChanged)
                .catch(say.failed);
            }}
          >
            Delete
          </button>
        </span>
      ) : null}
    </div>
  );
}

function ThreadCard({
  t,
  on,
  client,
  noteId,
  canComment,
  owner,
  onPick,
  onChanged,
  people,
}: {
  t: Thread;
  on: boolean;
  client: string;
  noteId: string;
  canComment: boolean;
  owner: boolean;
  onPick: () => void;
  onChanged: () => void;
  people: () => Promise<NotePeople | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const resolve = (on: boolean) =>
    notes(client, "resolve", { id: noteId, commentId: t.id, on })
      .then(() => {
        say.done(on ? "Resolved." : "Reopened.");
        onChanged();
      })
      .catch(say.failed);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: its buttons take the keys.
    <li
      onClick={onPick}
      data-on={on || undefined}
      className="flex flex-col gap-2 border border-(--ui-hair) bg-(--ui-paper) p-3 data-on:border-(--ui-accent)"
    >
      {t.quote ? (
        <p className="m-0 line-clamp-2 border-l-2 border-(--ui-accent) pl-2 text-[12px] text-(--ui-ink-2)">
          {t.quote}
        </p>
      ) : null}
      <One
        c={t}
        client={client}
        noteId={noteId}
        owner={owner}
        onChanged={onChanged}
        people={people}
      />
      {t.replies.map((r) => (
        <div key={r.id} className="border-t border-(--ui-hair) pt-2">
          <One
            c={r}
            client={client}
            noteId={noteId}
            owner={owner}
            onChanged={onChanged}
            people={people}
          />
        </div>
      ))}
      {t.resolvedAt ? (
        <p className="m-0 text-[12px] text-(--ui-ink-2)">
          Resolved by {t.resolvedBy} {relative(new Date(t.resolvedAt))}.
        </p>
      ) : null}
      {canComment ? (
        replying ? (
          <Compose
            people={people}
            placeholder="Reply"
            busy={busy}
            autoFocus
            onCancel={() => setReplying(false)}
            submit={async (body) => {
              setBusy(true);
              try {
                await notes(client, "comment", { id: noteId, parentId: t.id, body });
                setReplying(false);
                onChanged();
                return true;
              } catch (err) {
                say.failed(err);
                return false;
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <span className="flex gap-3">
            <button type="button" className={LINK} onClick={() => setReplying(true)}>
              Reply
            </button>
            <button type="button" className={LINK} onClick={() => void resolve(!t.resolvedAt)}>
              {t.resolvedAt ? "Reopen" : "Resolve"}
            </button>
          </span>
        )
      ) : null}
    </li>
  );
}

function SuggestionCard({
  s,
  editor,
  canAccept,
  me,
}: {
  s: Suggestion;
  editor: Editor;
  canAccept: boolean;
  me: string;
}) {
  const mine = s.by === me;
  return (
    <li className="flex flex-col gap-1.5 border border-(--ui-hair) bg-(--ui-paper) p-3">
      <Who email={s.by} at={s.at ? `${s.at}Z` : new Date().toISOString()} />
      <p className="m-0 text-[13px] break-words text-(--ui-ink)">
        {s.removed ? (
          <>
            Remove <del className="note-sugg-del">{s.removed}</del>
          </>
        ) : null}
        {s.removed && s.added ? ", add " : s.added ? "Add " : ""}
        {s.added ? <ins className="note-sugg-add">{s.added}</ins> : null}
      </p>
      {canAccept || mine ? (
        <span className="flex gap-2">
          {canAccept ? (
            <Button size="dense" icon="check" onClick={() => resolveSuggestions(editor, true, s)}>
              Accept
            </Button>
          ) : null}
          <Button
            size="dense"
            tone="secondary"
            icon="close"
            onClick={() => resolveSuggestions(editor, false, s)}
          >
            {mine && !canAccept ? "Take back" : "Reject"}
          </Button>
        </span>
      ) : null}
    </li>
  );
}

export function CommentsPanel({
  client,
  noteId,
  editor,
  data,
  draft,
  active,
  canAccept,
  me,
  people,
  onDraftDone,
  onPick,
  onChanged,
  onClose,
}: {
  client: string;
  noteId: string;
  editor: Editor | null;
  data: NoteComments | null;
  draft: { anchor: Anchor; quote: string } | null;
  active: string | null;
  canAccept: boolean;
  me: string;
  people: () => Promise<NotePeople | null>;
  onDraftDone: () => void;
  onPick: (id: string) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  useEffect(() => {
    if (!editor) return;
    const read = () => setSuggestions(suggestionsIn(editor.state.doc));
    read();
    editor.on("update", read);
    return () => void editor.off("update", read);
  }, [editor]);
  const threads = useMemo(
    () => (data?.threads ?? []).filter((t) => resolved || !t.resolvedAt),
    [data, resolved],
  );
  const hidden = (data?.threads ?? []).filter((t) => t.resolvedAt).length;
  return (
    <aside
      aria-label="Comments"
      className="flex min-h-0 w-full flex-col border-(--ui-hair) bg-(--ui-tile) max-lg:order-first max-lg:border-b lg:w-80 lg:flex-none lg:border-l print:hidden"
    >
      <div className="flex h-10 items-center justify-between border-b border-(--ui-hair) bg-(--ui-paper) pr-1 pl-3">
        <h2 className="m-0 text-[13px] font-semibold">Comments</h2>
        <button
          type="button"
          aria-label="Close comments"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover)"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 max-lg:max-h-96 lg:max-h-[calc(100dvh-180px)]">
        {draft && data?.canComment ? (
          <div className="flex flex-col gap-2 border border-(--ui-accent) bg-(--ui-paper) p-3">
            <p className="m-0 line-clamp-2 border-l-2 border-(--ui-accent) pl-2 text-[12px] text-(--ui-ink-2)">
              {draft.quote}
            </p>
            <Compose
              people={people}
              placeholder="Add a comment"
              busy={busy}
              autoFocus
              onCancel={onDraftDone}
              submit={async (body) => {
                setBusy(true);
                try {
                  const c = await notes(client, "comment", {
                    id: noteId,
                    body,
                    anchor: draft.anchor,
                    quote: draft.quote,
                  });
                  onDraftDone();
                  onChanged();
                  onPick(c.id);
                  return true;
                } catch (err) {
                  say.failed(err);
                  return false;
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        ) : null}
        {suggestions.length && editor ? (
          <section aria-label="Suggestions" className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="m-0 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
                Suggestions
              </h3>
              {canAccept && suggestions.length > 1 ? (
                <span className="ml-auto flex gap-3">
                  <button
                    type="button"
                    className={LINK}
                    onClick={() => resolveSuggestions(editor, true)}
                  >
                    Accept all
                  </button>
                  <button
                    type="button"
                    className={LINK}
                    onClick={() => resolveSuggestions(editor, false)}
                  >
                    Reject all
                  </button>
                </span>
              ) : null}
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {suggestions.map((s) => (
                <SuggestionCard
                  key={`${s.from}:${s.by}`}
                  s={s}
                  editor={editor}
                  canAccept={canAccept}
                  me={me}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {!data ? (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">Loading comments…</p>
        ) : threads.length ? (
          <ul aria-label="Threads" className="m-0 flex list-none flex-col gap-2 p-0">
            {threads.map((t) => (
              <ThreadCard
                key={t.id}
                t={t}
                on={t.id === active}
                client={client}
                noteId={noteId}
                canComment={data.canComment}
                owner={data.owner}
                onPick={() => onPick(t.id)}
                onChanged={onChanged}
                people={people}
              />
            ))}
          </ul>
        ) : !draft && !suggestions.length ? (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">
            {data.canComment
              ? "No comments yet. Select words in the note, then Comment."
              : "No comments yet."}
          </p>
        ) : null}
        {hidden ? (
          <button
            type="button"
            className={`${LINK} self-start`}
            onClick={() => setResolved(!resolved)}
          >
            {resolved ? "Hide resolved" : `Show resolved (${hidden})`}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
