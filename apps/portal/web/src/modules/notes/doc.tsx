/**
 * One note at /notes/doc/<id>: its title, the editor, the outline, version history and sharing.
 * It saves as you type, live with everyone else who has it open (`sync.ts`); a version is one
 * person's sitting. Comments and suggestions sit in the side panel (`comments.tsx`). Word files
 * come in batch 3: the menu says so.
 */
import type { Editor } from "@tiptap/core";
import { readTitle, toMarkdown } from "@wren/notes/doc";
import { type Role, Y_TITLE } from "@wren/notes/types";
import { Alert, Button, Empty, Icon, Loading, relative, say, Tag } from "@wren/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { socketToken, viewingAs } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { navigate } from "../../route.js";
import {
  docPath,
  hueOf,
  type NoteComments,
  type NoteOpen,
  type NotePeople,
  type NoteVersions,
  notes,
} from "./api.js";
import { type Anchor, anchorOf, CommentsPanel, goTo, showThreads } from "./comments.js";
import { type Heading, type Mode, NoteEditor, outlineOf, wordsIn } from "./editor.js";
import { ShareDialog } from "./share.js";
import { NoteSync, type SyncState } from "./sync.js";
import { VersionOpen, VersionsPanel } from "./versions.js";
import "./notes.css";

const SAID: Record<SyncState, string> = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline. Kept on this device until it's back.",
  failed: "Not saved",
};

/** The title as a Y.Text, edited by the smallest change so two people's edits merge. */
function setTitle(doc: Y.Doc, next: string) {
  const t = doc.getText(Y_TITLE);
  const old = t.toString();
  if (old === next) return;
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0;
  while (
    b < old.length - a &&
    b < next.length - a &&
    old[old.length - 1 - b] === next[next.length - 1 - b]
  )
    b++;
  doc.transact(() => {
    t.delete(a, old.length - a - b);
    t.insert(a, next.slice(a, next.length - b));
  });
}

function download(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .trim()
    .slice(0, 80) || "note";

/** A menu under a button; closes on a pick, outside, or Escape. */
function MoreMenu({
  items,
}: {
  items: ({ label: string; run?: () => void; soon?: boolean } | null)[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", off);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", off);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Button
        tone="secondary"
        size="dense"
        icon="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        More
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute top-9 right-0 z-30 flex w-64 flex-col border border-(--ui-hair) bg-(--ui-paper) py-1 shadow-lg"
        >
          {items.map((i, n) =>
            i === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: rules sit between fixed items.
              <hr key={n} className="my-1 border-0 border-t border-(--ui-hair)" />
            ) : (
              <button
                key={i.label}
                type="button"
                role="menuitem"
                disabled={i.soon}
                onClick={() => {
                  setOpen(false);
                  i.run?.();
                }}
                className="flex items-center justify-between gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[13.5px] text-(--ui-ink) hover:bg-(--ui-hover) disabled:text-(--ui-ink-2) disabled:hover:bg-transparent"
              >
                <span>{i.label}</span>
                {i.soon ? <Tag>In development</Tag> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function NoteDoc({ client, demo, params }: PageProps) {
  const id = location.pathname.split("/")[3] ?? "";
  const got = useCall(`notes:open:${client}:${id}`, () => notes(client, "open", { id }));
  if (got.error && !got.data)
    return (
      <Empty
        action={
          <Button size="dense" onClick={() => navigate("/notes/home")}>
            All notes
          </Button>
        }
      >
        {got.error.status === 404
          ? "No such note, or it isn't shared with you."
          : got.error.message}
      </Empty>
    );
  if (!got.data) return <Loading lines={10} heading />;
  return (
    <Doc
      key={`${client}:${id}`}
      client={client}
      note={got.data}
      reload={got.retry}
      demo={demo}
      focus={params.get("comment")}
    />
  );
}

function Doc({
  client,
  note: first,
  reload,
  demo,
  focus,
}: {
  client: string;
  note: NoteOpen;
  reload: () => void;
  demo: boolean;
  /** A comment to open on: from Mentions. */
  focus: string | null;
}) {
  const [note, setNote] = useState(first);
  useEffect(() => setNote(first), [first]);
  const [role, setRole] = useState<Role>(first.role);
  useEffect(() => setRole(note.role), [note.role]);
  const canEdit = (role === "edit" || role === "owner") && !demo;
  // A commenter suggests: their changes go in as suggestions, never as edits.
  const canSuggest = role === "comment" && !demo;
  const owner = role === "owner" && !demo;
  const [suggesting, setSuggesting] = useState(false);
  const mode: Mode | null = canEdit
    ? { suggesting, locked: false, set: setSuggesting }
    : canSuggest
      ? { suggesting: true, locked: true, set: () => {} }
      : null;
  const [state, setState] = useState<SyncState>("saved");
  const [refused, setRefused] = useState<string | null>(null);
  const [title, setTitleText] = useState(note.title);
  const [edited, setEdited] = useState({ at: note.updatedAt, by: note.editedBy });
  const [version, setVersion] = useState(note.version);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [heads, setHeads] = useState<Heading[]>([]);
  const [words, setWords] = useState(0);
  const [panel, setPanel] = useState<"history" | "comments" | null>(focus ? "comments" : null);
  const [outline, setOutline] = useState(true);
  const [shown, setShown] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [list, setList] = useState<NoteVersions | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [people, setPeople] = useState<NotePeople | null>(null);
  const [live, setLive] = useState(false);
  const [comments, setComments] = useState<NoteComments | null>(null);
  const [draft, setDraft] = useState<{ anchor: Anchor; quote: string } | null>(null);
  const [active, setActive] = useState<string | null>(focus);

  const readComments = useCallback(
    () =>
      notes(client, "comments", { id: note.id })
        .then(setComments)
        .catch(() => {}),
    [client, note.id],
  );
  useEffect(() => void readComments(), [readComments]);

  // The doc and its sync live as long as the page; a key change makes a new page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: made once per note.
  const sync = useMemo(
    () =>
      new NoteSync({
        client,
        id: note.id,
        state: note.state,
        role: demo ? "view" : note.role,
        hooks: {
          onState: setState,
          onSaved: (out) => {
            setEdited({ at: out.updatedAt ?? "", by: out.editedBy });
            setVersion(out.version);
          },
          onRefused: setRefused,
          onRole: (r) => {
            setRole(r);
            void readComments();
          },
          onComments: () => void readComments(),
          onLive: setLive,
        },
        // A commenter's copy isn't kept: a change the server refused would come back on reload.
        keepLocal: !demo && note.role !== "comment",
        live: demo || viewingAs ? null : socketToken,
      }),
    [],
  );
  useEffect(() => () => void sync.stop(), [sync]);

  // The highlights follow the threads and the one picked.
  useEffect(() => {
    if (editor && comments) showThreads(editor, comments.threads, active);
  }, [editor, comments, active]);

  // From Mentions: to the comment's words once they're drawn.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !focus || !editor || !comments) return;
    focused.current = true;
    // A reply's mention opens its thread.
    const t = comments.threads.find((x) => x.id === focus || x.replies.some((r) => r.id === focus));
    if (!t) return;
    setActive(t.id);
    goTo(editor, t);
  }, [focus, editor, comments]);

  const commentChanged = useCallback(() => {
    void readComments();
    sync.commented();
  }, [readComments, sync]);

  const startComment = useCallback(() => {
    if (!editor) return;
    const a = anchorOf(editor);
    if (!a) return say.failed(new Error("Select the words to comment on."));
    setDraft(a);
    setShown(null);
    setPanel("comments");
  }, [editor]);

  const pick = useCallback(
    (id: string) => {
      setActive(id);
      setPanel("comments");
      const t = comments?.threads.find((x) => x.id === id);
      if (editor && t) goTo(editor, t);
    },
    [comments, editor],
  );

  // The title follows the doc, so a rename elsewhere shows here.
  useEffect(() => {
    const t = sync.doc.getText(Y_TITLE);
    const read = () => setTitleText(readTitle(sync.doc));
    t.observe(read);
    return () => t.unobserve(read);
  }, [sync]);

  useEffect(() => {
    if (!editor) return;
    const read = () => {
      setHeads(outlineOf(editor));
      setWords(wordsIn(editor));
    };
    read();
    editor.on("update", read);
    return () => void editor.off("update", read);
  }, [editor]);

  // With the note: whether each person could open it, for `@`.
  const peopleOnce = useRef<Promise<NotePeople | null> | null>(null);
  const loadPeople = useCallback(() => {
    peopleOnce.current ??= notes(client, "people", { id: note.id }).catch(() => null);
    return peopleOnce.current;
  }, [client, note.id]);
  useEffect(() => {
    if (sharing) void loadPeople().then(setPeople);
  }, [sharing, loadPeople]);

  const readVersions = useCallback(
    () =>
      notes(client, "versions", { id: note.id })
        .then((v) => {
          setList(v.versions);
          setListError(null);
        })
        .catch((e: Error) => setListError(e.message)),
    [client, note.id],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new version reads the list again.
  useEffect(() => {
    if (panel === "history") void readVersions();
  }, [panel, version, readVersions]);

  const reopen = () => {
    void notes(client, "open", { id: note.id }).then(setNote).catch(say.failed);
  };
  const act = (route: "star" | "archive" | "train", on: boolean, done: string) =>
    notes(client, route, { id: note.id, on })
      .then(() => {
        say.done(done);
        reopen();
      })
      .catch(say.failed);

  const markdown = () => {
    if (!editor) return;
    const md = toMarkdown(editor.getJSON() as never);
    download(`${fileName(note.name)}.md`, "text/markdown", title ? `# ${title}\n\n${md}` : md);
  };

  const open = comments?.threads.filter((t) => !t.resolvedAt).length ?? 0;
  const status =
    refused ??
    (state === "saved" && edited.at
      ? `Saved. Edited ${relative(new Date(edited.at))}${edited.by ? ` by ${edited.by}` : ""}`
      : SAID[state]);

  return (
    <div className="flex min-h-[calc(100dvh-140px)] flex-col border border-(--ui-hair) bg-(--ui-paper)">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--ui-hair) bg-(--ui-paper) px-4 py-2.5 print:hidden">
        <a
          href="/notes/home"
          className="inline-flex items-center gap-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
        >
          <Icon name="left" />
          Notes
        </a>
        <input
          value={title}
          readOnly={!canEdit || suggesting}
          maxLength={300}
          aria-label="Title"
          placeholder="Untitled"
          onChange={(e) => {
            setTitleText(e.target.value);
            setTitle(sync.doc, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor?.commands.focus("start");
            }
          }}
          className="min-w-0 flex-1 basis-60 border-0 bg-transparent px-1 py-1 font-(family-name:--ui-font-display) text-[20px] font-(--ui-display-weight) text-(--ui-ink) outline-none hover:bg-(--ui-hover) focus:bg-(--ui-hover)"
        />
        <div className="flex flex-wrap items-center gap-2">
          {note.kind === "dump" ? <Tag>Dump</Tag> : null}
          {note.archived ? <Tag tone="warn">Archived</Tag> : null}
          {!canEdit ? <Tag>{canSuggest ? "Can comment" : "View only"}</Tag> : null}
          {live ? <Here sync={sync} /> : null}
          {!demo ? (
            <button
              type="button"
              aria-pressed={note.starred}
              aria-label={note.starred ? "Unstar" : "Star"}
              title={note.starred ? "Starred" : "Star it"}
              onClick={() => act("star", !note.starred, note.starred ? "Unstarred." : "Starred.")}
              className="inline-flex size-8 items-center justify-center border-0 bg-transparent text-(--ui-ink-3) hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-pressed:text-(--ui-accent)"
            >
              <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
                <path
                  d="M8 2.25l1.75 3.6 3.95.55-2.85 2.75.7 3.9L8 11.2l-3.55 1.85.7-3.9L2.3 6.4l3.95-.55z"
                  fill={note.starred ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={1.3}
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          <Button
            tone="secondary"
            size="dense"
            aria-pressed={panel === "comments"}
            onClick={() => {
              setPanel(panel === "comments" ? null : "comments");
              setShown(null);
            }}
          >
            Comments
            {open ? ` (${open})` : ""}
          </Button>
          <Button
            tone="secondary"
            size="dense"
            icon="clock"
            aria-pressed={panel === "history"}
            onClick={() => {
              setPanel(panel === "history" ? null : "history");
              setShown(null);
            }}
          >
            History
          </Button>
          <Button size="dense" icon="people" onClick={() => setSharing(true)}>
            Share
          </Button>
          <MoreMenu
            items={[
              { label: outline ? "Hide outline" : "Show outline", run: () => setOutline(!outline) },
              { label: "Print or save as PDF", run: () => print() },
              { label: "Download Markdown", run: markdown },
              { label: "Download Word (.docx)", soon: true },
              null,
              { label: "Turn into a task, draft or SOP", soon: true },
              null,
              ...(owner
                ? [
                    {
                      label: note.train ? "Leave out of training" : "Use for training",
                      run: () =>
                        act(
                          "train",
                          !note.train,
                          note.train
                            ? "Left out of training."
                            : "It goes into training exports now.",
                        ),
                    },
                    {
                      label: note.archived ? "Bring back from Archived" : "Archive",
                      run: () =>
                        act(
                          "archive",
                          !note.archived,
                          note.archived
                            ? "Back in your notes."
                            : "Archived. Find it under Archived.",
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <p className="m-0 w-full text-[12px] text-(--ui-ink-2)" aria-live="polite">
          {note.parent ? (
            <>
              In{" "}
              <a href={docPath(note.parent.id)} className="text-(--ui-ink-2)">
                {note.parent.name}
              </a>
              {". "}
            </>
          ) : null}
          <span className={state === "failed" || refused ? "text-(--ui-bad)" : undefined}>
            {status}
          </span>
          {note.agent ? " Written with Claude." : ""}
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {outline && heads.length ? (
          <nav
            aria-label="Outline"
            className="hidden w-56 flex-none overflow-y-auto border-r border-(--ui-hair) px-3 py-4 xl:block print:hidden"
          >
            <h2 className="m-0 mb-2 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
              Outline
            </h2>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {heads.map((h) => (
                <li key={`${h.pos}`} style={{ paddingLeft: (h.level - 1) * 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!editor) return;
                      editor.commands.setTextSelection(h.pos + 1);
                      (editor.view.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({
                        block: "start",
                        behavior: "smooth",
                      });
                    }}
                    className="w-full truncate border-0 bg-transparent px-1 py-0.5 text-left text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
                  >
                    {h.text || "Untitled heading"}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <main className="min-w-0 flex-1 bg-(--ui-tile)">
          {shown !== null && list ? (
            <VersionOpen
              client={client}
              id={note.id}
              number={shown}
              list={list}
              canEdit={canEdit}
              onBack={() => setShown(null)}
              onRestored={() => {
                setShown(null);
                sync.now();
                void readVersions();
              }}
              onNamed={() => void readVersions()}
            />
          ) : (
            <div className="note-sheet" data-print>
              <h1 className="note-title-static hidden print:block">{title || note.name}</h1>
              <NoteEditor
                client={client}
                id={note.id}
                doc={sync.doc}
                editable={canEdit || canSuggest}
                people={loadPeople}
                onEditor={setEditor}
                live={demo ? null : { awareness: sync.awareness, me: note.me }}
                mode={mode}
                onComment={comments?.canComment ? startComment : null}
                onPickComment={pick}
              />
            </div>
          )}
          <p className="m-0 px-4 py-3 text-center text-[12px] text-(--ui-ink-2) print:hidden">
            {words} {words === 1 ? "word" : "words"}
            {note.children.length ? (
              <>
                {" · Inside: "}
                {note.children.map((c, i) => (
                  <span key={c.id}>
                    {i ? ", " : ""}
                    <a href={docPath(c.id)} className="text-(--ui-ink-2)">
                      {c.name}
                    </a>
                  </span>
                ))}
              </>
            ) : null}
          </p>
        </main>
        {panel === "comments" ? (
          <CommentsPanel
            client={client}
            noteId={note.id}
            editor={editor}
            data={comments}
            draft={draft}
            active={active}
            canAccept={canEdit}
            me={note.me}
            people={loadPeople}
            onDraftDone={() => setDraft(null)}
            onPick={pick}
            onChanged={commentChanged}
            onClose={() => {
              setPanel(null);
              setDraft(null);
              setActive(null);
            }}
          />
        ) : null}
        {panel === "history" ? (
          <VersionsPanel
            list={list}
            error={listError}
            open={shown}
            onOpen={setShown}
            onClose={() => {
              setPanel(null);
              setShown(null);
            }}
          />
        ) : null}
      </div>
      {sharing ? (
        <ShareDialog
          client={client}
          note={note}
          people={people}
          open={sharing}
          onOpenChange={setSharing}
          onChanged={reopen}
        />
      ) : null}
      {refused && !canEdit ? (
        <Alert onRetry={canSuggest ? () => location.reload() : reload}>{refused}</Alert>
      ) : null}
    </div>
  );
}

/** Who else has the note open now: a dot in their hue each, their email on hover. */
function Here({ sync }: { sync: NoteSync }) {
  const [who, setWho] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      const seen = new Set<string>();
      for (const [id, st] of sync.awareness.getStates()) {
        const email = (st as { user?: { email?: string } }).user?.email;
        if (id !== sync.doc.clientID && email) seen.add(email);
      }
      setWho([...seen].sort());
    };
    read();
    sync.awareness.on("change", read);
    return () => sync.awareness.off("change", read);
  }, [sync]);
  if (!who.length) return null;
  return (
    <span className="flex items-center gap-1" title={`Here now: ${who.join(", ")}`}>
      {who.slice(0, 4).map((e) => (
        <span
          key={e}
          aria-hidden="true"
          className="inline-flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-(--ui-paper) uppercase"
          style={{ background: hueOf(e) }}
        >
          {e[0]}
        </span>
      ))}
      {who.length > 4 ? (
        <span className="text-[12px] text-(--ui-ink-2)">+{who.length - 4}</span>
      ) : null}
      <span className="sr-only">Here now: {who.join(", ")}</span>
    </span>
  );
}
