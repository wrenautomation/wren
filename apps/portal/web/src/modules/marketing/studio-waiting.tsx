/**
 * Studio's waiting drafts, on the shared `Rows`: an idea a row (kind, words, line, platforms,
 * slot, age), a check to approve it in place with an Undo, and a click that opens its platforms
 * side by side to edit, rewrite, post now or drop. "Schedule all" saves every open card's typing
 * first. By line groups the rows under each offer line.
 */

import { ownThreadOf, PLATFORM_SPECS } from "@wren/content/write";
import { threadPosts } from "@wren/core/content/thread";
import type { MetroLine } from "@wren/pipeline/metro";
import {
  ACTIONS,
  BottomSheet,
  Button,
  cx,
  DeviceFrame,
  EditConflict,
  Empty,
  FeedPost,
  holdWithUndo,
  Input,
  LoadFailed,
  Loading,
  type Patch,
  PHONE_WIDTH,
  PlatformMark,
  patchRecord,
  Rows,
  type RowsColumn,
  type RowsLine,
  type RowsName,
  recordKey,
  SaveConflict,
  SaveStatus,
  Segmented,
  Tag,
  Textarea,
  useEdit,
  useHeld,
  useNarrow,
  usePhone,
  useSaved,
} from "@wren/ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@wren/ui/components/ui/sheet";
import { useEffect, useRef, useState } from "react";
import { patchCalls, useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { wrenRecords } from "../../records.js";
import { href } from "../../route.js";
import { ERROR, QUIET } from "../work/bits.js";
import { DRAFT_SET } from "./ask.js";
import { deskCall } from "./desk.js";
import { type SopCheck, SopCheckList } from "./sop-check.js";
import {
  chosen,
  desk,
  headlineOf,
  kindOfIdea,
  lateSlot,
  listed,
  makeKind,
  message,
  nameOf,
  sentence,
  slotOf,
  type Waiting,
  waited,
  when,
} from "./studio-common.js";
import { CARD, EYEBROW } from "./studio-due.js";
import { LineName, lineColour } from "./studio-lines.js";

type Act = "approve" | "now" | "rewrite" | "reject" | "check";
/** Each card's flush, so a yes on the whole board saves every card's typing first. */
type Flushers = Set<() => Promise<boolean>>;

/** The board's answer with one draft's words as the server now holds them. */
const wroteWords =
  (id: string, text: string): Patch =>
  (key, data) => {
    if (!key.startsWith("studio-waiting:") || !data || typeof data !== "object") return data;
    const ideas = (data as { ideas?: Waiting[] }).ideas;
    if (!ideas?.some((i) => i.drafts.some((x) => x.id === id))) return data;
    return {
      ...data,
      ideas: ideas.map((i) => ({
        ...i,
        drafts: i.drafts.map((x) => (x.id === id ? { ...x, text, edited: true } : x)),
      })),
    };
  };

/** One waiting draft: its words to edit in place, and what can be done with it. */
function DraftCard({
  d,
  at,
  demo,
  sop,
  flushers,
  onDone,
}: {
  d: Waiting["drafts"][number];
  /** The SOP check is Wren's own only: the standard and his calls live in Wren's Learn. */
  sop: boolean;
  /** When the board's read left: an older read never lands over his typing. */
  at: number;
  demo: boolean;
  flushers: Flushers;
  onDone: () => void;
}) {
  // The same journal and save as the draft's own page (DraftBox): typing there or here is one
  // draft's words, saved a pause after the last key, never per key, and never read back.
  const savedKey = d.story ? null : `draft:${DRAFT_SET}:${d.id}`;
  const s = useSaved<string>({
    key: savedKey,
    server: d.text,
    at,
    same: (a, b) => a.trim() === b.trim(),
    save: async (words, { expect, request }) => {
      const text = words.trim();
      const from = String(expect ?? "");
      const out = await deskCall<{ version?: string | null } | null>("DraftAsk", "set", {
        record: "draft",
        id: d.id,
        text,
        expect: from.trim() ? from : null,
        requestId: request,
      });
      return { value: text, version: out?.version ?? null };
    },
    onSaved: (text, { version }) => {
      patchCalls(wroteWords(d.id, text));
      // Drafts and To approve hold the same words and version: a yes there names these.
      patchRecord(wrenRecords("marketing"), "marketing.draft", d.id, {
        text,
        ...(version ? { version } : {}),
      });
    },
    onConflict: onDone,
  });
  useEffect(() => {
    flushers.add(s.flush);
    return () => void flushers.delete(s.flush);
  }, [flushers, s.flush]);
  const text = s.value;
  // What to change, kept until the rewrite goes: another page and back gives it again.
  const note = useEdit(`draft:${d.id}:rewrite-note`, "");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<Act | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The check just asked for shows at once; the board's next read carries it too.
  const [checked, setChecked] = useState<SopCheck | null>(null);
  const check = checked ?? d.check ?? null;
  const max = PLATFORM_SPECS[d.platform].maxChars;
  // The same check the yes runs: a thread's posts, else the platform's length.
  const unfit = d.thread
    ? (() => {
        const v = ownThreadOf(text);
        return "reason" in v ? sentence(v.reason) : null;
      })()
    : null;
  const missing = d.missing ?? [];
  // The card leads with the post as a phone's feed shows it; the words open under it.
  const looks = !d.story && !d.carousel;
  const [editing, setEditing] = useState(false);
  const open = !looks || editing || s.dirty || !!s.conflict || !!unfit || text.length > max;

  const act = async (what: Act) => {
    setBusy(what);
    setError(null);
    const sent = note.value;
    try {
      // Every act reads the saved words: his typing lands first, or nothing goes on.
      if (!(await s.flush())) {
        setBusy(null);
        return;
      }
      if (what === "check") {
        const out = await ACTIONS.run(`studio:check:${d.id}`, (requestId) =>
          desk<{ check: SopCheck | null; why: string | null }>(
            "check",
            { draftId: d.id },
            requestId,
          ),
        );
        if (out.check) setChecked({ ...out.check, stale: false });
        else setError(out.why ?? "The check gave nothing back.");
        setBusy(null);
        return;
      }
      // One press, one act: a second press while it's out gets the first's answer.
      await ACTIONS.run(`studio:${what}:${d.id}`, (requestId) =>
        what === "rewrite"
          ? desk("redraft", { draftId: d.id, note: note.value }, requestId)
          : what === "reject"
            ? desk("reject", { ids: [d.id] }, requestId)
            : desk("approve", { ids: [d.id], now: what === "now" }, requestId),
      );
      if (what === "rewrite") {
        note.saved(sent);
        setAsking(false);
      }
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(null);
    }
  };

  return (
    <div className="grid content-start gap-2 bg-(--ui-paper) px-3.5 py-3 [border-radius:6px_20px] shadow-(--ui-raise)">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <PlatformMark mark={d.platform} size={16} />
          <span className="text-[14px] font-semibold">{nameOf(d.platform)}</span>
          {d.state === "failed" ? <Tag tone="warn">Failed</Tag> : null}
          {d.story ? (
            <Tag tone="accent">Story</Tag>
          ) : d.carousel ? (
            <Tag tone="accent">Carousel</Tag>
          ) : d.thread ? (
            <Tag tone="accent">Thread</Tag>
          ) : d.own ? (
            <Tag tone="accent">Yours</Tag>
          ) : d.edited ? (
            <Tag>Edited</Tag>
          ) : null}
        </span>
        {d.story ? null : d.thread ? (
          <span className={cx("text-[12px] [font-variant-numeric:tabular-nums]", QUIET)}>
            {threadPosts(text).length} posts
          </span>
        ) : (
          <span
            className={cx(
              "text-[12px] [font-variant-numeric:tabular-nums]",
              text.length > max ? "text-(--ui-bad)" : QUIET,
            )}
          >
            {text.length} / {max}
          </span>
        )}
      </div>
      {looks ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit the ${nameOf(d.platform)} draft`}
          className="block w-full cursor-text border-0 bg-transparent p-0 text-left"
        >
          <DeviceFrame width={PHONE_WIDTH}>
            <FeedPost
              from="Wren Automation"
              title={d.title}
              body={d.thread ? (threadPosts(text)[0] ?? text) : text}
              lines={PLATFORM_SPECS[d.platform].feed.phone}
              size={15}
            />
          </DeviceFrame>
        </button>
      ) : d.title ? (
        <b className="text-[14px]">{d.title}</b>
      ) : null}
      {d.story ? (
        <p className={cx("m-0 text-[13.5px]", QUIET)}>
          A story: the photo or clip goes as is, with no words.
        </p>
      ) : !open ? (
        <Button size="dense" tone="quiet" className="w-fit" onClick={() => setEditing(true)}>
          Edit the words
        </Button>
      ) : (
        <>
          <Textarea
            aria-label={`${nameOf(d.platform)} draft`}
            data-edit={savedKey ?? ""}
            rows={Math.min(14, Math.max(4, Math.ceil(text.length / 48)))}
            value={text}
            disabled={demo || !!busy}
            onChange={(e) => s.set(e.target.value)}
            onBlur={() => void s.flush()}
          />
          <SaveStatus state={s} onRetry={s.retry} />
          {s.conflict ? (
            <SaveConflict
              conflict={s.conflict}
              onKeepMine={s.keepMine}
              onTakeTheirs={s.takeTheirs}
            />
          ) : null}
        </>
      )}
      {unfit ? <p className={ERROR}>{unfit}</p> : null}
      {missing.length ? (
        <p className={ERROR}>
          Fill in {listed(missing)} before Approve. <a href={`/content/drafts/${d.id}`}>Open it</a>{" "}
          to pick.
        </p>
      ) : null}
      <a className="text-[13px]" href={`/content/drafts/${d.id}`}>
        {d.carousel
          ? "Open the slides, fields and versions"
          : "Open for fields, media and versions"}
      </a>
      {d.error ? <p className={ERROR}>{d.error}</p> : null}
      {asking || note.dirty ? (
        <div className="grid gap-2">
          <Input
            aria-label="What to change"
            {...note.field}
            placeholder="What to change: shorter, lead with the number…"
          />
          <EditConflict
            what="The note"
            conflict={note.conflict}
            onKeepMine={note.keepMine}
            onTakeTheirs={note.takeTheirs}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="dense"
              disabled={!note.value.trim() || !!busy}
              onClick={() => void act("rewrite")}
            >
              {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </Button>
            <Button
              size="dense"
              tone="quiet"
              onClick={() => {
                note.discard();
                setAsking(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            tone="primary"
            size="dense"
            disabled={!!busy || demo}
            onClick={() => void act("approve")}
          >
            {busy === "approve" ? "Scheduling…" : "Schedule"}
          </Button>
          <Button
            size="dense"
            tone="secondary"
            disabled={!!busy || demo}
            onClick={() => void act("now")}
          >
            {busy === "now" ? "Posting…" : "Post now"}
          </Button>
          {d.story || d.carousel ? null : (
            <Button
              size="dense"
              tone="quiet"
              disabled={!!busy || demo}
              onClick={() => setAsking(true)}
            >
              Rewrite with AI
            </Button>
          )}
          {sop && !d.story && !d.carousel ? (
            <Button
              size="dense"
              tone="quiet"
              disabled={!!busy || demo}
              onClick={() => void act("check")}
            >
              {busy === "check" ? "Checking…" : check ? "Check again" : "Check against the SOP"}
            </Button>
          ) : null}
          <Button
            size="dense"
            tone="quiet"
            disabled={!!busy || demo}
            onClick={() => void act("reject")}
          >
            {busy === "reject" ? "Dropping…" : "Drop"}
          </Button>
        </div>
      )}
      {check && sop ? <SopCheckList check={check} /> : null}
      {error ? <p className={ERROR}>{error}</p> : null}
    </div>
  );
}

/** Where a draft's holds live: Approve in a row sets its ids aside here for the undo. */
const MANY = "studio-drafts";
const APPROVED = "Approved";

/** The row's age and slot as one cell's words. */
const slotWords = (i: Waiting) => {
  const at = slotOf(i);
  return at === null ? "Next free slot" : when(new Date(at).toISOString());
};

/** Every idea's drafts that wait on a yes, as a table: open one for its platforms side by side. */
export function WaitingBoard(
  props: PageProps & { lines: ReadonlyMap<string, MetroLine>; line: string | null },
) {
  // One key for every read: a reload replaces the kept answer, never adds a new one.
  const load = useCall("studio-waiting", () => desk<{ ideas: Waiting[] }>("waiting", {}));
  const reload = load.retry;
  const held = useHeld(MANY);
  // A press that landed: read the board again, so the row it took away is gone for good.
  const landed = useRef(held.landed);
  useEffect(() => {
    if (landed.current === held.landed) return;
    landed.current = held.landed;
    reload();
  }, [held.landed, reload]);

  const only = chosen(props.params);
  const ideas = load.data?.ideas
    .map((i) => ({ ...i, drafts: i.drafts.filter((d) => !only || d.platform === only) }))
    .filter((i) => i.drafts.length)
    .filter((i) => !props.line || i.line === props.line)
    .filter((i) => !i.drafts.every((d) => held.ids.has(d.id)));
  const ids = ideas?.flatMap((i) => i.drafts.map((d) => d.id)) ?? [];
  const late = ideas?.filter((i) => lateSlot(i)).length ?? 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flushers] = useState<Flushers>(() => new Set());
  const [open, setOpen] = useState<string | null>(null);
  const phone = usePhone();
  const peek = ideas?.find((i) => i.ideaId === open) ?? null;
  // The idea it showed is gone (approved, dropped, rewritten away): shut it.
  useEffect(() => {
    if (open && ideas && !peek) setOpen(null);
  }, [open, ideas, peek]);

  /** Every open card's typing lands first; false when one didn't save. */
  const flushAll = async () => !(await Promise.all([...flushers].map((f) => f()))).includes(false);
  const close = async () => {
    await flushAll();
    setOpen(null);
  };

  const all = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await flushAll())) throw new Error("A draft didn't save. Fix it, then try again.");
      await ACTIONS.run(`studio:all:${ids.join(",")}`, (requestId) =>
        desk("approve", { ids }, requestId),
      );
      reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  /** A row's check: its drafts go aside for the undo, and the call goes when the time ends. */
  const approve = async (i: Waiting) => {
    setError(null);
    if (!(await flushAll())) return void setError("A draft didn't save. Fix it, then try again.");
    const mine = i.drafts.map((d) => d.id);
    holdWithUndo({
      press: {
        key: `held studio:approve:${mine.join(",")}`,
        what: "approve",
        label: "Approve",
        records: mine.map((id) => recordKey(MANY, id)),
      },
      commit: (requestId) => desk("approve", { ids: mine }, requestId),
      line: `${APPROVED}: ${headlineOf(i).title}`,
    });
  };

  const view = props.params.get("view") === "line" ? "line" : "table";
  const groups = view === "line" && ideas ? byLine(ideas, props.lines) : null;
  const narrow = useNarrow();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // Under its line's fold, a row needs no Line column.
  const columns = columnsOf(props.lines).filter((c) => !groups || c.key !== "line");
  const lines = linesOf(ideas ?? [], groups);

  return (
    <section aria-labelledby="studio-waiting" className="min-w-0">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="studio-waiting" className={EYEBROW}>
          Waiting{ideas ? ` · ${ids.length}` : ""}
        </h2>
        {/* A phone has room for one word: the other view, as a link. */}
        <a
          href={href("/content/studio", { view: view === "line" ? "" : "line" }, props.params)}
          className="text-[13px] font-medium text-(--ui-link) no-underline hover:underline sm:hidden"
        >
          {view === "line" ? "Table" : "By line"}
        </a>
        <div className="flex items-center gap-2 max-sm:hidden">
          {ids.length > 1 ? (
            <Button
              size="dense"
              tone="quiet"
              disabled={busy || props.demo}
              onClick={() => void all()}
            >
              Schedule all
            </Button>
          ) : null}
          <Segmented
            label="Group the waiting drafts"
            className="w-[168px]"
            items={[
              {
                id: "table",
                label: "Table",
                href: href("/content/studio", { view: "" }, props.params),
                on: view === "table",
              },
              {
                id: "line",
                label: "By line",
                href: href("/content/studio", { view: "line" }, props.params),
                on: view === "line",
              },
            ]}
          />
        </div>
      </div>
      {load.error && !ideas ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !ideas ? (
        <Loading shape="rows" lines={5} />
      ) : ideas.length === 0 ? (
        <Empty>{only ? `No ${nameOf(only)} draft waits on you.` : "No draft waits on you."}</Empty>
      ) : (
        <div className={cx(CARD, "overflow-hidden max-sm:[border-radius:6px_20px]")}>
          <Rows<Waiting>
            label="drafts"
            noun="draft"
            narrow={narrow}
            // The page scrolls the rows: the board has no panel of its own.
            scroller="window"
            lines={lines}
            columns={columns}
            name={draftName(narrow, props.lines)}
            open={{ id: open, onOpen: (i) => setOpen(i.ideaId) }}
            rowProps={(i) => ({ "data-late": lateSlot(i) ? "" : undefined })}
            end={(i) => (
              <ApproveButton idea={i} demo={props.demo} approve={() => void approve(i)} />
            )}
            group={
              groups
                ? {
                    folded,
                    toggle: (key) =>
                      setFolded((was) => {
                        const next = new Set(was);
                        if (!next.delete(key)) next.add(key);
                        return next;
                      }),
                  }
                : undefined
            }
          />
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5 text-[12px] text-(--ui-ink-3) max-sm:gap-x-1">
            <span>
              {ids.length === 1 ? "1 draft" : `${ids.length} drafts`}
              {ideas.length !== ids.length ? ` in ${ideas.length} ideas` : ""}
            </span>
            {late ? (
              <span className="inline-flex items-center gap-1.5 sm:ml-auto">
                {/* A desk sets it apart with a dot; a phone runs it on, as the board does. */}
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-(--ui-warn) max-sm:hidden"
                />
                <span aria-hidden="true" className="sm:hidden">
                  ·
                </span>
                {late} past its slot
              </span>
            ) : null}
          </p>
        </div>
      )}
      {error ? <p className={ERROR}>{error}</p> : null}
      {peek ? (
        <Peek idea={peek} lines={props.lines} phone={phone} close={() => void close()}>
          {peek.drafts.map((d) => (
            <DraftCard
              key={d.id}
              d={d}
              at={load.at}
              demo={props.demo}
              sop={props.client === WREN.id}
              flushers={flushers}
              onDone={reload}
            />
          ))}
        </Peek>
      ) : null}
    </section>
  );
}

/** Ideas grouped under their offer line, in the shape's order; ideas with no line last. */
function byLine(ideas: Waiting[], lines: ReadonlyMap<string, MetroLine>) {
  const out = [...lines.values()].map((line) => ({
    id: line.id,
    line,
    ideas: ideas.filter((i) => i.line === line.id),
  }));
  const rest = ideas.filter((i) => !i.line || !lines.has(i.line));
  return [
    ...out.filter((g) => g.ideas.length),
    ...(rest.length ? [{ id: "none", line: undefined, ideas: rest }] : []),
  ];
}

/** The lines `Rows` draws: the ideas in order, or a fold for each offer line with its ideas. */
function linesOf(ideas: Waiting[], groups: ReturnType<typeof byLine> | null): RowsLine<Waiting>[] {
  const row = (i: Waiting, index: number): RowsLine<Waiting> => ({
    kind: "row",
    key: i.ideaId,
    index,
    row: i,
  });
  if (!groups) return ideas.map(row);
  let index = 0;
  return groups.flatMap((g) => [
    {
      kind: "group" as const,
      key: g.id,
      label: g.line ? <LineName line={g.line} /> : <span>No line</span>,
    },
    ...g.ideas.map((i) => row(i, index++)),
  ]);
}

/** The letter each kind's mark carries in a row: P, T, C, S, B, V. */
const KIND_LETTER: Record<ReturnType<typeof kindOfIdea>, string> = {
  post: "P",
  thread: "T",
  carousel: "C",
  story: "S",
  blog: "B",
  video: "V",
};

/** A row's kind: its letter on a tint of its line's colour, ink-3 when it serves no line. */
function KindMark({ idea, line }: { idea: Waiting; line: MetroLine | undefined }) {
  const kind = makeKind(kindOfIdea(idea));
  const colour = lineColour(line);
  return (
    <span
      title={kind.name}
      className="inline-flex size-7 flex-none items-center justify-center text-[11px] leading-none font-semibold [border-radius:5px_11px] max-sm:size-[30px]"
      style={{ color: colour, background: `color-mix(in srgb, ${colour} 12%, transparent)` }}
    >
      <span aria-hidden="true">{KIND_LETTER[kind.id]}</span>
      <span className="sr-only">{kind.name}</span>
    </span>
  );
}

/** A platform a draft goes to, as the board's small tag: 11 px, 600, a fill, a leaf. */
const PLATFORM_TAG =
  "inline-flex items-center px-[7px] py-[3px] text-[11px] leading-[14px] font-semibold text-(--ui-ink-2) bg-(--ui-fill) [border-radius:4px_8px] whitespace-nowrap";

/** The draft: its kind's mark, the words and the hook. A phone's row adds the slot and the wait. */
function draftName(narrow: boolean, lines: ReadonlyMap<string, MetroLine>): RowsName<Waiting> {
  return {
    label: "Draft",
    icon: "doc",
    min: 220,
    title: (i) => headlineOf(i).title,
    mark: (i) => <KindMark idea={i} line={i.line ? lines.get(i.line) : undefined} />,
    sub: (i) => {
      const { hook } = headlineOf(i);
      return (
        <>
          {hook && !narrow ? (
            <span className="wrap-anywhere whitespace-normal text-[12px] text-(--ui-ink-3)">
              {hook}
            </span>
          ) : null}
          {narrow ? (
            <span
              className={cx(
                "wrap-anywhere whitespace-normal text-[12px]",
                lateSlot(i) ? "text-(--ui-warn-ink)" : "text-(--ui-ink-3)",
              )}
            >
              {[slotWords(i), waited(i)].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </>
      );
    },
  };
}

/** The columns beside the draft: line, platforms, slot, age. A phone keeps the draft alone. */
function columnsOf(lines: ReadonlyMap<string, MetroLine>): RowsColumn<Waiting>[] {
  return [
    {
      key: "line",
      label: "Line",
      icon: "branch",
      width: 150,
      cell: (i) => (
        <LineName line={i.line ? lines.get(i.line) : undefined} className="text-[13px]" />
      ),
    },
    {
      key: "platforms",
      label: "Platforms",
      icon: "globe",
      width: 180,
      cell: (i) => (
        <span className="flex flex-wrap gap-1">
          {[...new Set(i.drafts.map((d) => d.platform))].map((p) => (
            <span key={p} className={PLATFORM_TAG}>
              {nameOf(p)}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "slot",
      label: "Slot",
      icon: "calendar",
      width: 130,
      cell: (i) => (
        <span
          className={cx(
            "inline-flex min-w-0 items-center gap-1.5 text-[13px]",
            lateSlot(i) ? "text-(--ui-warn-ink)" : "text-(--ui-ink-2)",
          )}
        >
          {lateSlot(i) ? (
            <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-(--ui-warn)" />
          ) : null}
          <span className="wrap-anywhere whitespace-normal">{slotWords(i)}</span>
        </span>
      ),
    },
    {
      key: "age",
      label: "Age",
      icon: "clock",
      width: 110,
      cell: (i) => (
        <span
          className={cx(
            "text-[13px] font-medium tabular-nums",
            lateSlot(i) ? "text-(--ui-warn-ink)" : "text-(--ui-ink-3)",
          )}
        >
          {waited(i)}
        </span>
      ),
    },
  ];
}

/** A row's check: approve the idea in place; it waits on a draft that lacks something. */
function ApproveButton({
  idea,
  demo,
  approve,
}: {
  idea: Waiting;
  demo: boolean;
  approve: () => void;
}) {
  const missing = idea.drafts.flatMap((d) => d.missing ?? []);
  const { title } = headlineOf(idea);
  return (
    <Button
      tone="quiet"
      size="dense"
      icon="check"
      aria-label={`Approve ${title}`}
      title={missing.length ? `Fill in ${listed([...new Set(missing)])} first` : "Approve"}
      disabled={demo || missing.length > 0}
      className="text-(--ui-ink-3) hover:text-(--ui-active)"
      onClick={(e) => {
        e.stopPropagation();
        approve();
      }}
    >
      <span className="sr-only">Approve</span>
    </Button>
  );
}

/** One idea's drafts, side by side: a side sheet on a desk, a bottom sheet on a phone. */
function Peek({
  idea,
  lines,
  phone,
  close,
  children,
}: {
  idea: Waiting;
  lines: ReadonlyMap<string, MetroLine>;
  phone: boolean;
  close: () => void;
  children: React.ReactNode;
}) {
  const { title } = headlineOf(idea);
  const line = idea.line ? lines.get(idea.line) : undefined;
  const body = (
    <div className="grid gap-3 px-4 pb-6">
      {line ? <LineName line={line} className="text-[13px]" /> : null}
      {children}
    </div>
  );
  if (phone)
    return (
      <BottomSheet label={title} onClose={close} stops={["large"]} start="large">
        {body}
      </BottomSheet>
    );
  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle className="pr-8">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            The platforms this draft goes to. Edit the words, approve, post now or drop.
          </SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}
