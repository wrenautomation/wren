/**
 * Notes' home, like Docs': Recent, Owned by me, Shared with me, Starred and Archived, and a
 * search over every note the viewer can open (Postgres full text). New note, Quick note, and
 * imports: a Word or Markdown file, or a Google Doc by its link.
 */
import {
  Alert,
  Button,
  Empty,
  Icon,
  Input,
  Loading,
  PageHeader,
  relative,
  Section,
  say,
  Tag,
} from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { go, href, navigate } from "../../route.js";
import { docPath, type NoteRow, notes, VIEWS, type View } from "./api.js";
import { QuickNote } from "./capture.js";
import { IMPORT_ACCEPT, importDrive, importFile } from "./files.js";

const PATH = "/notes/home";

const EMPTY: Record<View, string> = {
  recent: "No notes yet. Start one, or press N anywhere for a quick note.",
  mine: "You don't own a note yet.",
  shared: "Nothing is shared with you yet.",
  starred: "Star a note to keep it here.",
  archived: "Nothing archived.",
};

/** Bold the words the search found (`«…»` from the server). Checkbox and cell marks read as prose. */
function Excerpt({ text }: { text: string }) {
  const parts = text
    .replace(/\[[x ]\] /g, "")
    .replace(/ \| /g, ", ")
    .split(/«|»/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one string, in order.
          <mark key={i} className="bg-(--ui-warn-tint) text-(--ui-ink)">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Row({ n, me, onStar }: { n: NoteRow; me: string; onStar: (() => void) | null }) {
  const owner = n.mine ? "You" : n.owner.startsWith("agent:") ? "Claude" : n.owner;
  return (
    <li className="flex items-start gap-3 border-b border-(--ui-hair) px-3 py-3 hover:bg-(--ui-wash)">
      <Icon name="note" className="mt-0.5 flex-none text-(--ui-ink-2)" />
      <a href={docPath(n.id)} className="min-w-0 flex-1 text-(--ui-ink) no-underline">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-[14.5px] font-medium">{n.name}</span>
          {n.kind === "dump" ? <Tag>Dump</Tag> : null}
          {n.home !== "wren" || !n.mine ? null : n.general === "workspace" ? (
            <Tag>Everyone here</Tag>
          ) : null}
          {n.home === "wren" && me && !n.mine && n.via === "agent" ? (
            <Tag tone="accent">Claude</Tag>
          ) : null}
        </span>
        {n.excerpt ? (
          <span className="mt-0.5 line-clamp-2 block text-[13px] text-(--ui-ink-2)">
            <Excerpt text={n.excerpt} />
          </span>
        ) : null}
        <span className="mt-1 block text-[12px] text-(--ui-ink-2)">
          {owner}, edited {relative(new Date(n.updatedAt))}
          {n.editedBy && n.editedBy !== n.owner ? ` by ${n.editedBy}` : ""}
        </span>
      </a>
      {onStar ? (
        <button
          type="button"
          aria-pressed={n.starred}
          aria-label={n.starred ? `Unstar ${n.name}` : `Star ${n.name}`}
          onClick={onStar}
          className="inline-flex size-8 flex-none items-center justify-center border-0 bg-transparent text-(--ui-ink-3) hover:text-(--ui-ink) aria-pressed:text-(--ui-accent)"
        >
          <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden="true">
            <path
              d="M8 2.25l1.75 3.6 3.95.55-2.85 2.75.7 3.9L8 11.2l-3.55 1.85.7-3.9L2.3 6.4l3.95-.55z"
              fill={n.starred ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </li>
  );
}

export function NotesHome({ client, params, demo }: PageProps) {
  const view = (VIEWS.find(([v]) => v === params.get("view"))?.[0] ?? "recent") as View;
  const q = params.get("q") ?? "";
  const [typed, setTyped] = useState(q);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setTyped(q), [q]);
  // Typing searches after a beat; the address keeps it.
  useEffect(() => {
    if (typed === q) return;
    const t = setTimeout(() => go(PATH, { q: typed.trim() || null }, params), 300);
    return () => clearTimeout(t);
  }, [typed, q, params]);

  const list = useCall(`notes:home:${client}:${view}:${q}`, () =>
    notes(client, "home", { view: q ? "all" : view, q: q || undefined }),
  );
  const data = list.data;
  const writes = !demo && !!data?.canWrite;

  const create = () => {
    setBusy(true);
    notes(client, "create", {})
      .then((r) => navigate(docPath(r.id)))
      .catch(say.failed)
      .finally(() => setBusy(false));
  };
  const [drive, setDrive] = useState(false);
  const [importing, setImporting] = useState(false);
  const importOne = (f: File) => {
    setImporting(true);
    importFile(client, f)
      .then((id) => navigate(docPath(id)))
      .catch(say.failed)
      .finally(() => setImporting(false));
  };
  const star = (n: NoteRow) =>
    notes(client, "star", { id: n.id, on: !n.starred })
      .then(() => list.retry())
      .catch(say.failed);

  return (
    <>
      <PageHeader
        title="Notes"
        lede="Rough thoughts, plans and docs. Each keeps its versions, and links to the rest of your work."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {writes ? (
          <>
            <Button size="dense" icon="note" busy={busy} onClick={() => create()}>
              New note
            </Button>
            <Button tone="secondary" size="dense" onClick={() => setQuick(true)}>
              Quick note
            </Button>
            <Button
              tone="secondary"
              size="dense"
              icon="download"
              busy={importing}
              onClick={() => file.current?.click()}
            >
              Import Word or Markdown
            </Button>
            <input
              ref={file}
              type="file"
              accept={IMPORT_ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importOne(f);
                e.target.value = "";
              }}
            />
            <Button tone="secondary" size="dense" onClick={() => setDrive(true)}>
              From Google Docs
            </Button>
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 border border-(--ui-hair) bg-(--ui-paper)">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-(--ui-hair) bg-(--ui-band) px-2 pt-2">
          <nav aria-label="Views" className="flex min-w-0 flex-wrap gap-0.5">
            {VIEWS.map(([v, label]) => (
              <a
                key={v}
                href={href(PATH, { view: v === "recent" ? null : v, q: null })}
                aria-current={!q && v === view ? "page" : undefined}
                className="border-b-2 border-transparent px-2.5 py-2 text-[13.5px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink) aria-[current=page]:border-(--ui-accent) aria-[current=page]:font-medium aria-[current=page]:text-(--ui-ink)"
              >
                {label}
              </a>
            ))}
          </nav>
          <Input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search every note"
            aria-label="Search every note"
            className="mb-2 ml-auto h-8 w-full rounded-none text-[13.5px] sm:w-64"
          />
        </div>
        {list.error && !data ? (
          <div className="p-3">
            <Alert onRetry={list.retry}>{list.error.message}</Alert>
          </div>
        ) : !data ? (
          <Loading lines={6} />
        ) : !data.notes.length ? (
          <Empty className="border-0 bg-transparent">
            {q ? `No note has “${q}”.` : EMPTY[view]}
          </Empty>
        ) : (
          <ul className="m-0 -mt-3 list-none p-0">
            {data.notes.map((n) => (
              <Row
                key={`${n.home}:${n.id}`}
                n={n}
                me={data.me}
                onStar={demo ? null : () => void star(n)}
              />
            ))}
          </ul>
        )}
      </div>
      {data?.canManage ? (
        <div className="mt-8">
          <Training client={client} on={data.train} onChanged={list.retry} />
        </div>
      ) : null}
      {quick ? (
        <QuickNote client={client} open={quick} onOpenChange={setQuick} onSaved={list.retry} />
      ) : null}
      {drive ? <FromDrive client={client} onClose={() => setDrive(false)} /> : null}
    </>
  );
}

/** A manager decides whether every note here goes into training exports. */
function Training({
  client,
  on,
  onChanged,
}: {
  client: string;
  on: boolean;
  onChanged: () => void;
}) {
  return (
    <Section title="Training">
      <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
        <span className="min-w-0 flex-1">
          {on
            ? "Every note here goes into training exports."
            : "Only notes their owners opt in go into training exports. Off by default."}
        </span>
        <Button
          tone="secondary"
          size="dense"
          onClick={() =>
            notes(client, "workspaceTrain", { on: !on }).then(onChanged).catch(say.failed)
          }
        >
          {on ? "Only opted-in notes" : "Include every note"}
        </Button>
      </div>
    </Section>
  );
}

/** A Google Doc by its link: Wren reads it as its service account, or as anyone with the link. */
function FromDrive({ client, onClose }: { client: string; onClose: () => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const who = useCall(`notes:settings:${client}`, () => notes(client, "settings", {}));
  const sa = who.data?.drive ?? null;
  const go = () => {
    if (!link.trim()) return;
    setBusy(true);
    setFailed(null);
    importDrive(client, link.trim())
      .then((id) => {
        onClose();
        navigate(docPath(id));
      })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Google Docs</DialogTitle>
          <DialogDescription>
            Paste the doc's link. It comes in as a new note; the doc stays as it is.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <Input
            value={link}
            autoFocus
            aria-label="The doc's link"
            placeholder="https://docs.google.com/document/d/…"
            onChange={(e) => setLink(e.target.value)}
          />
          {failed ? <Alert>{failed}</Alert> : null}
          <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
            {sa ? (
              <>
                Share the doc with <span className="font-mono break-all text-(--ui-ink)">{sa}</span>
                , or set it to Anyone with the link.
              </>
            ) : (
              "Set the doc to Anyone with the link first."
            )}{" "}
            Word files in Drive work too, up to 4 MB.
          </p>
          <div className="flex justify-end gap-2">
            <Button tone="secondary" size="dense" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button size="dense" type="submit" busy={busy} disabled={!link.trim() || busy}>
              Import
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
