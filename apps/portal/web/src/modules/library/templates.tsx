/**
 * Library, Templates: every template in its folder (the kit's `Browser`), and the open one's
 * editor with a live preview for the made-up lead, its history with a diff and restore, and its
 * numbers. Writes go through `templates/*` (TemplatesConsole), each checked at the template's own
 * app and channel. A save names the version it opened; when someone saved since, the editor
 * shows "Changed since you opened it" with the diff, to reload theirs or save on top. Publishing
 * copy that sends waits in To approve; a prompt goes live at once.
 */
import type { RecordAnswer } from "@wren/core/records/serve";
import type { TemplateListRow, TemplateOpen, TemplateSaved } from "@wren/core/templates/console";
import type { TemplateDetail } from "@wren/core/templates/edits";
import { folderLabel, labelOf, nameLabel, nameParts } from "@wren/core/templates/labels";
import {
  Browser,
  BrowserRow,
  Button,
  DictateField,
  Diff,
  Empty,
  Input,
  LoadFailed,
  Loading,
  type MessageKind,
  MessagePreview,
  PageHeader,
  relative,
  say,
  Tag,
  type TagTone,
  Textarea,
  useCopy,
} from "@wren/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { go, navigate } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { Numbers } from "./numbers.js";
import { CHANNEL } from "./sequence.js";

const PATH = "/library/templates";

type Head = NonNullable<TemplateOpen["live"]>;
type Version = TemplateOpen["versions"][number];

const STATUS: Record<TemplateListRow["status"], [string, TagTone]> = {
  default: ["Default", "neutral"],
  edited: ["Edited", "green"],
  updated: ["Default updated", "accent"],
  waiting: ["Waiting approval", "accent"],
  empty: ["Empty", "neutral"],
};

const APP: Record<string, string> = {
  outbound: "Outbound",
  texts: "Texts",
  marketing: "Marketing",
  reactivation: "Reactivation",
  library: "Library",
};

const ORIGIN: Record<string, string> = {
  default: "Wren's default",
  edit: "Edit",
  restore: "Restored",
  ai: "Claude",
  import: "Imported",
};

/** Where texts and DMs save: their copy pages, which hold each slot's rules. */
const COPY_PAGE: Record<string, string> = {
  sms: "/marketing/text-copy",
  dm: "/marketing/dm-copy",
};

const SELECT =
  "h-8 min-w-0 border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink)";
const PRE =
  "max-h-[420px] overflow-auto whitespace-pre-wrap break-words border border-(--ui-hair) bg-(--ui-fill) p-3 font-mono text-[12.5px]/[1.55]";

const ago = (at: string | null) => (at ? relative(new Date(at)) : "");
const byLine = (by: string | null, at: string | null) => [by, ago(at)].filter(Boolean).join(", ");
/** Who wrote a version, as a person reads it: Wren's defaults by name, never the deploy. */
const who = (by: string | null, origin: string | null) =>
  origin === "default" ? "Wren's default" : by === "cli" ? "the CLI" : by;

export function Templates({ params, demo, can }: PageProps) {
  // Old links name a template in the path (/library/templates/12): open it by the query.
  useEffect(() => {
    const id = location.pathname.split("/")[3];
    if (id) navigate(`${PATH}?open=${encodeURIComponent(decodeURIComponent(id))}`, true);
  }, []);
  const folder = params.get("folder") ?? "";
  const openId = params.get("open");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [app, setApp] = useState("");
  const [status, setStatus] = useState("");
  const list = useCall("templates:list", async () => {
    const got = await call<{ templates: TemplateListRow[]; labels?: Record<string, string> }>(
      "templates/list",
    );
    // A niche's folder reads its label ("SEC RIA"), as the server names it.
    nameParts(got.labels ?? {});
    return got;
  });
  const rows = list.data?.templates ?? [];
  const folders = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) n.set(r.folder, (n.get(r.folder) ?? 0) + 1);
    return [...n].map(([path, count]) => ({ path, count }));
  }, [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!folder || r.folder === folder || r.folder.startsWith(`${folder}/`)) &&
      (!kind || r.kind === kind) &&
      (!app || r.app === app) &&
      (!status || r.status === status) &&
      (!needle || `${r.ref}\n${r.words}`.toLowerCase().includes(needle)),
  );
  const open = rows.find((r) => String(r.id) === openId) ?? null;
  const writes = !demo && (can?.includes("act") ?? true);
  const setOpen = (id: number | null) => go(PATH, { open: id }, params);
  const reload = () => list.retry();
  const move = (to: string, ref: string) =>
    call("templates/move", { ref, folder: to })
      .then(() => {
        say.done(to ? `Moved to ${folderLabel(to)}.` : "Moved out of its folder.");
        reload();
      })
      .catch(say.failed);
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const apps = [...new Set(rows.map((r) => r.app))];

  return (
    <>
      <PageHeader
        title="Templates"
        lede="Every template and prompt in its folder. Saving keeps a new version. Nothing sends until a version is live."
      />
      {list.error && !list.data ? (
        <LoadFailed error={list.error} onRetry={list.retry} />
      ) : !list.data ? (
        <Loading lines={8} />
      ) : (
        <Browser
          label="Templates"
          folders={folders}
          folder={folder}
          onFolder={(path) => go(PATH, { folder: path, open: null }, params)}
          rootLabel="All templates"
          nameOf={labelOf}
          folderActions={
            writes && folder ? (
              <RenameFolder key={folder} folder={folder} onDone={reload} params={params} />
            ) : null
          }
          onDrop={
            writes
              ? (to, id) => {
                  const r = rows.find((x) => String(x.id) === id);
                  if (r && r.folder !== to) void move(to, r.ref);
                }
              : undefined
          }
          head={
            <>
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search names and words"
                aria-label="Search names and words"
                className="h-8 rounded-none text-[13.5px]"
              />
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  className={SELECT}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  aria-label="Kind"
                >
                  <option value="">Kind</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {CHANNEL[k] ?? k}
                    </option>
                  ))}
                </select>
                <select
                  className={SELECT}
                  value={app}
                  onChange={(e) => setApp(e.target.value)}
                  aria-label="App"
                >
                  <option value="">App</option>
                  {apps.map((a) => (
                    <option key={a} value={a}>
                      {APP[a] ?? a}
                    </option>
                  ))}
                </select>
                <select
                  className={SELECT}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Status"
                >
                  <option value="">Status</option>
                  {Object.entries(STATUS).map(([s, [label]]) => (
                    <option key={s} value={s}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          }
          list={
            shown.length ? (
              <ul className="list-none border-t border-(--ui-hair)">
                {shown.map((r) => (
                  <BrowserRow
                    key={r.id}
                    id={String(r.id)}
                    open={r.id === open?.id}
                    onOpen={() => setOpen(r.id)}
                    draggable={writes}
                  >
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-[14px] font-medium">{nameLabel(r.name)}</span>
                      <Tag tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Tag>
                    </span>
                    <span className={`truncate text-[12.5px] ${QUIET}`}>
                      {[
                        CHANNEL[r.kind] ?? r.kind,
                        folderLabel(r.folder, folder) || null,
                        byLine(who(r.by, r.origin), r.at),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </BrowserRow>
                ))}
              </ul>
            ) : (
              <p className={`py-6 text-[14px] ${QUIET}`}>
                {rows.length ? "Nothing here matches." : "No template is stored yet."}
              </p>
            )
          }
          detail={
            open ? (
              <Open
                key={open.ref}
                row={open}
                writes={writes}
                folders={folders.map((f) => f.path)}
                onChanged={reload}
                onMove={(to) => move(to, open.ref)}
              />
            ) : null
          }
          placeholder={
            <Empty>Open a template to edit its words, see its history or read its numbers.</Empty>
          }
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function RenameFolder({
  folder,
  onDone,
  params,
}: {
  folder: string;
  onDone: () => void;
  params: URLSearchParams;
}) {
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (to === null)
    return (
      <Button tone="quiet" size="dense" onClick={() => setTo(folder)}>
        Rename
      </Button>
    );
  const save = async () => {
    const name = to.trim().replace(/^\/+|\/+$/g, "");
    if (!name || name === folder) return setTo(null);
    setBusy(true);
    try {
      const got = await call<{ moved: number }>("templates/renameFolder", {
        from: folder,
        to: name,
      });
      say.done(`Renamed. ${got.moved} moved with it.`);
      setTo(null);
      onDone();
      go(PATH, { folder: name }, params);
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex min-w-0 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        aria-label="Folder name"
        className="h-8 min-w-0 rounded-none text-[13px]"
        autoFocus
      />
      <Button size="dense" type="submit" busy={busy}>
        Rename
      </Button>
      <Button tone="quiet" size="dense" onClick={() => setTo(null)}>
        Cancel
      </Button>
    </form>
  );
}

type Tab = "words" | "history" | "numbers";

/** The open template: where it stands, then its words, history or numbers. */
function Open({
  row,
  writes,
  folders,
  onChanged,
  onMove,
}: {
  row: TemplateListRow;
  writes: boolean;
  folders: string[];
  onChanged: () => void;
  onMove: (to: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("words");
  const got = useCall(`templates:detail:${row.ref}`, () =>
    call<TemplateOpen>("templates/detail", { ref: row.ref }),
  );
  const d = got.data;
  const refresh = () => {
    got.retry();
    onChanged();
  };
  if (got.error && !d) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!d) return <Loading lines={8} />;
  const mayWrite = writes && d.mayAct && d.editable;
  return (
    <article className="grid min-w-0 gap-4">
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-[19px]/[1.25] font-semibold break-words">
            {nameLabel(d.name)}
          </h2>
          <Tag tone={STATUS[d.status][1]}>{STATUS[d.status][0]}</Tag>
        </div>
        <p className={`text-[13px] ${QUIET}`}>
          {[CHANNEL[d.kind] ?? d.kind, APP[row.app] ?? row.app, folderLabel(d.folder) || null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <RefLine refText={d.ref} />
        <Standing d={d} />
      </header>
      {mayWrite ? <Controls d={d} folders={folders} onDone={refresh} onMove={onMove} /> : null}
      <div role="tablist" aria-label="Template" className="flex gap-4 border-b border-(--ui-hair)">
        {(
          [
            ["words", "Words"],
            ["history", `History (${d.versions.length})`],
            ["numbers", "Numbers"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`bg-transparent cursor-pointer -mb-px border-0 border-b-2 border-solid pb-2 text-[14px] ${
              tab === id
                ? "border-(--ui-ink) font-medium"
                : "border-transparent text-(--ui-ink-2) hover:text-(--ui-ink)"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "words" ? (
        <Editor d={d} mayWrite={mayWrite} writes={writes} onSaved={refresh} />
      ) : tab === "history" ? (
        <History d={d} mayWrite={mayWrite} onRestored={refresh} />
      ) : (
        <NumbersTab id={String(row.id)} />
      )}
    </article>
  );
}

/** The ref Claude Code and the CLI take, once, small, with a copy button. */
function RefLine({ refText }: { refText: string }) {
  const { copied, copy } = useCopy();
  return (
    <p className="flex min-w-0 items-center gap-2 text-[12px] text-(--ui-ink-3)">
      <code className="min-w-0 truncate font-mono">{refText}</code>
      <button
        type="button"
        onClick={() => copy(refText)}
        className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-(--ui-ink-2) underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:text-(--ui-ink)"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}

/** Live, draft and waiting versions in one line each. */
function Standing({ d }: { d: TemplateOpen }) {
  const line = (label: string, h: Head | null, by?: string | null) =>
    h ? (
      <li>
        <span className="font-medium">{label}</span> version {h.number}
        <span className={QUIET}> · {byLine(by ?? who(h.by, h.origin), h.at)}</span>
      </li>
    ) : null;
  return (
    <ul className="list-none grid gap-0.5 text-[13.5px]">
      {d.live ? (
        line("Live:", d.live)
      ) : (
        <li className={QUIET}>Nothing is live, so nothing sends.</li>
      )}
      {d.draft && d.draft.number !== d.live?.number && d.draft.number !== d.waiting?.number
        ? line("Draft:", d.draft)
        : null}
      {line("Waiting approval:", d.waiting, d.waitingBy)}
      {d.status === "updated" && d.newestDefault ? (
        <li className={QUIET}>
          Wren's default changed to version {d.newestDefault.number}. Yours stays live until you
          reset.
        </li>
      ) : null}
    </ul>
  );
}

/** Publish, reset to default and move, each asking first. */
function Controls({
  d,
  folders,
  onDone,
  onMove,
}: {
  d: TemplateOpen;
  folders: string[];
  onDone: () => void;
  onMove: (to: string) => Promise<void>;
}) {
  const [ask, setAsk] = useState<"publish" | "reset" | "move" | null>(null);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState(d.folder);
  const draft = d.draft && d.draft.number !== d.live?.number ? d.draft : null;
  const canPublish = !!draft && d.waiting?.number !== draft.number;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      say.done(done);
      setAsk(null);
      onDone();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  const publish = () =>
    run(
      () => call("templates/publish", { ref: d.ref, number: draft?.number }),
      d.sends
        ? `Version ${draft?.number} waits in To approve.`
        : `Version ${draft?.number} is live.`,
    );
  const reset = () => run(() => call("templates/reset", { ref: d.ref }), "Back on Wren's default.");
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {canPublish ? (
          <Button size="dense" onClick={() => setAsk("publish")}>
            {d.sends ? "Ask to publish" : "Publish"}
          </Button>
        ) : null}
        {!d.followsDefault && d.newestDefault ? (
          <Button tone="secondary" size="dense" onClick={() => setAsk("reset")}>
            Reset to default
          </Button>
        ) : null}
        <Button tone="secondary" size="dense" onClick={() => setAsk("move")}>
          Move to folder
        </Button>
      </div>
      {ask === "publish" && draft ? (
        <Confirm
          line={
            d.sends
              ? `Version ${draft.number} goes to To approve. It goes live when a person approves it. Nothing sends from here.`
              : `Version ${draft.number} goes live now. The next draft it writes uses it.`
          }
          yes={d.sends ? "Ask" : "Publish"}
          busy={busy}
          onYes={publish}
          onNo={() => setAsk(null)}
        />
      ) : null}
      {ask === "reset" && d.newestDefault ? (
        <Confirm
          line={`Wren's default, version ${d.newestDefault.number}, goes live now. Your versions stay in History.`}
          yes="Reset"
          busy={busy}
          onYes={reset}
          onNo={() => setAsk(null)}
        />
      ) : null}
      {ask === "move" ? (
        <form
          className="flex flex-wrap items-center gap-2 border border-(--ui-hair) p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => onMove(to.trim().replace(/^\/+|\/+$/g, "")), "Moved.");
          }}
        >
          <label className="grid min-w-0 flex-1 gap-1 text-[13px]">
            <span className={QUIET}>Type a new name to make a new folder.</span>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              list="template-folders"
              className="h-8 rounded-none text-[13.5px]"
              autoFocus
            />
            <datalist id="template-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <div className="flex gap-2 self-end">
            <Button size="dense" type="submit" busy={busy}>
              Move
            </Button>
            <Button tone="quiet" size="dense" onClick={() => setAsk(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Confirm({
  line,
  yes,
  busy,
  onYes,
  onNo,
}: {
  line: string;
  yes: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="grid gap-2 border border-(--ui-hair) p-3 text-[14px]">
      <p>{line}</p>
      <div className="flex gap-2">
        <Button size="dense" busy={busy} onClick={onYes}>
          {yes}
        </Button>
        <Button tone="quiet" size="dense" onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type Sample = { sample: { subject?: string | null; body: string } | null; problem: string | null };

/** Words with the made-up lead in them, as the reader gets them. */
function Rendered({ kind, got }: { kind: string; got: Sample | null }) {
  if (!got) return <Loading lines={3} />;
  if (!got.sample)
    return <p className="text-[14px] text-(--ui-bad)">It doesn't render: {got.problem}</p>;
  if (kind === "email" || kind === "sms") {
    const message: MessageKind =
      kind === "email" ? { kind: "email", subject: got.sample.subject ?? "" } : { kind: "sms" };
    return <MessagePreview message={message} body={got.sample.body} />;
  }
  return <pre className={PRE}>{got.sample.body}</pre>;
}

/** The words opened, the editor, and the preview under it. */
function Editor({
  d,
  mayWrite,
  writes,
  onSaved,
}: {
  d: TemplateOpen;
  mayWrite: boolean;
  writes: boolean;
  onSaved: () => void;
}) {
  const opened = d.draft ?? d.live;
  const [base, setBase] = useState<{ number: number | null; words: string }>({
    number: d.opened,
    words: opened?.source ?? "",
  });
  const [words, setWords] = useState(base.words);
  const wordsBox = useRef<HTMLTextAreaElement>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Head | null>(null);
  const dirty = words !== base.words;
  // Someone else's save comes in on a reload: follow it while nothing here is changed.
  useEffect(() => {
    if (dirty || d.opened === base.number) return;
    const w = (d.draft ?? d.live)?.source ?? "";
    setBase({ number: d.opened, words: w });
    setWords(w);
  }, [d, dirty, base.number]);
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      call<Sample>("templates/preview", { ref: d.ref, words })
        .then((s) => live && setSample(s))
        .catch((err) => live && setSample({ sample: null, problem: String(err?.message ?? err) }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [d.ref, words]);

  const save = async (expect: number | null) => {
    setBusy(true);
    try {
      const got = await call<TemplateSaved>("templates/save", {
        ref: d.ref,
        words,
        why: why.trim() || null,
        expect,
      });
      if (got.conflict) return setConflict(got.conflict);
      const n = got.saved?.draft?.number ?? null;
      setBase({ number: got.saved?.opened ?? n, words });
      setConflict(null);
      setWhy("");
      say.done(`Saved as version ${n}. Nothing sends until it's live.`);
      onSaved();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  const reload = () => {
    if (!conflict) return;
    setBase({ number: conflict.number, words: conflict.source });
    setWords(conflict.source);
    setConflict(null);
    onSaved();
  };

  const where = COPY_PAGE[d.kind];
  return (
    <div className="grid min-w-0 gap-4">
      {conflict ? (
        <div
          role="alert"
          className="grid gap-3 border border-(--ui-warn) bg-(--ui-warn-tint) p-3 text-[14px]"
        >
          <div>
            <p className="font-semibold">Changed since you opened it</p>
            <p className={QUIET}>
              {conflict.by ?? "Someone"} saved version {conflict.number} {ago(conflict.at)}. Theirs
              is on the left, yours on the right.
            </p>
          </div>
          <Diff
            a={conflict.source}
            b={words}
            names={[`Version ${conflict.number}, theirs`, "Yours, not saved"]}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="dense" tone="secondary" onClick={reload}>
              Reload theirs
            </Button>
            <Button size="dense" busy={busy} onClick={() => save(conflict.number)}>
              Save yours on top
            </Button>
          </div>
        </div>
      ) : null}
      {!d.editable ? (
        <p className={`text-[14px] ${QUIET}`}>
          {CHANNEL[d.kind] ?? d.kind} copy saves on its own page, which holds its rules.{" "}
          {where ? (
            <a className="text-(--ui-ink) underline" href={where}>
              Open {d.kind === "sms" ? "text" : "DM"} copy
            </a>
          ) : null}
        </p>
      ) : writes && !d.mayAct ? (
        <p className={`text-[14px] ${QUIET}`}>
          You can read this one. Changing it needs edit access to {CHANNEL[d.kind] ?? d.kind} in the
          app that sends it.
        </p>
      ) : null}
      <label className="grid min-w-0 gap-1.5">
        <span className={`text-[13px] ${QUIET}`}>
          {opened ? `Version ${opened.number}` : "No words yet"}
          {dirty ? ", changed" : ""}
        </span>
        <DictateField target={wordsBox} off={!mayWrite}>
          <Textarea
            ref={wordsBox}
            value={words}
            onChange={(e) => setWords(e.target.value)}
            readOnly={!mayWrite}
            spellCheck
            className="max-h-[28rem] min-h-56 overflow-auto rounded-none font-mono text-[13px]/[1.55] md:text-[13px]"
          />
        </DictateField>
      </label>
      {mayWrite ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save(base.number);
          }}
        >
          <label className="grid min-w-0 flex-1 basis-56 gap-1 text-[13px]">
            <span className={QUIET}>Why (one line)</span>
            <Input
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Shorter opener"
              maxLength={500}
              className="h-8 rounded-none text-[13.5px]"
            />
          </label>
          <Button size="dense" type="submit" busy={busy} disabled={!dirty || !!conflict}>
            Save
          </Button>
          {dirty ? (
            <Button
              tone="quiet"
              size="dense"
              onClick={() => {
                setWords(base.words);
                setConflict(null);
              }}
            >
              Discard changes
            </Button>
          ) : null}
        </form>
      ) : null}
      <section className="grid min-w-0 gap-2">
        <h3 className="text-[13px] font-semibold">Preview</h3>
        <p className={`text-[13px] ${QUIET}`}>
          Filled in for Sam Rivera of Northwind Staffing, a made-up lead.
        </p>
        <Rendered kind={d.kind} got={sample} />
      </section>
    </div>
  );
}

/** Every version, newest first. Pick two to compare; restore any as the new draft. */
function History({
  d,
  mayWrite,
  onRestored,
}: {
  d: TemplateOpen;
  mayWrite: boolean;
  onRestored: () => void;
}) {
  const first = d.draft?.number ?? d.versions[0]?.number ?? null;
  const second = d.live?.number !== first ? (d.live?.number ?? null) : null;
  const [picked, setPicked] = useState<number[]>(
    [first, second ?? d.versions[1]?.number ?? null].filter((n): n is number => n !== null),
  );
  const [busy, setBusy] = useState<number | null>(null);
  const pick = (n: number) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n].slice(-2)));
  const [a, b] = [...picked]
    .sort((x, y) => x - y)
    .map((n) => d.versions.find((v) => v.number === n));
  const restore = async (v: Version) => {
    setBusy(v.number);
    try {
      const got = await call<TemplateSaved>("templates/restore", {
        ref: d.ref,
        number: v.number,
        expect: d.opened,
      });
      if (got.conflict)
        say.failed(
          new Error("Someone changed it since you opened it. Showing the newest version."),
        );
      else
        say.done(`Version ${v.number}'s words are now draft version ${got.saved?.draft?.number}.`);
      onRestored();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(null);
    }
  };
  const tags = (v: Version) => (
    <>
      {v.number === d.live?.number ? <Tag tone="green">Live</Tag> : null}
      {v.number === d.waiting?.number ? <Tag tone="accent">Waiting</Tag> : null}
      {v.number === d.draft?.number && v.number !== d.live?.number ? <Tag>Draft</Tag> : null}
    </>
  );
  return (
    <div className="grid min-w-0 gap-5">
      <ul className="list-none border-t border-(--ui-hair)">
        {d.versions.map((v) => (
          <li
            key={v.number}
            // Restore keeps its own column on the right, however the words beside it wrap.
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-(--ui-hair) py-2.5 text-[13.5px]"
          >
            <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.includes(v.number)}
                  onChange={() => pick(v.number)}
                  aria-label={`Compare version ${v.number}`}
                  className="size-4 accent-(--ui-accent)"
                />
                <span className="font-medium tabular-nums">Version {v.number}</span>
              </label>
              <span className="flex flex-wrap gap-1">{tags(v)}</span>
              <span className="min-w-0 flex-1 basis-60">
                <span className={QUIET}>
                  {v.origin === "default"
                    ? byLine("Wren's default", v.at)
                    : [ORIGIN[v.origin] ?? v.origin, byLine(who(v.by, v.origin), v.at)]
                        .filter(Boolean)
                        .join(" · ")}
                  {v.openedFrom ? ` · from version ${v.openedFrom}` : ""}
                </span>
                {v.why ? <span className="block">{v.why}</span> : null}
              </span>
            </div>
            {mayWrite && v.number !== (d.draft ?? d.live)?.number ? (
              <Button
                tone="secondary"
                size="dense"
                busy={busy === v.number}
                onClick={() => restore(v)}
              >
                Restore
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {a && b ? (
        <section className="grid min-w-0 gap-2">
          <h3 className="text-[13px] font-semibold">
            Version {a.number} against version {b.number}
          </h3>
          <Diff a={a.source} b={b.source} names={[`Version ${a.number}`, `Version ${b.number}`]} />
        </section>
      ) : (
        <p className={`text-[13.5px] ${QUIET}`}>Pick two versions to compare them.</p>
      )}
    </div>
  );
}

function NumbersTab({ id }: { id: string }) {
  const got = useCall(`templates:numbers:${id}`, () =>
    call<RecordAnswer>("console/recordsGet", { record: "templates.template", id }),
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={5} />;
  const d = got.data.detail as TemplateDetail | null;
  return d ? <Numbers d={d} /> : <p className={QUIET}>No numbers yet.</p>;
}
