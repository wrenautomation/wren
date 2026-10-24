/**
 * The Record template: one record as its own page (`RecordPage`) or as a panel's body
 * (`RecordBody`): its head, then tabs for details with the live preview beside them, each related
 * type, activity and sources. Edits, history and Ask Claude draw inside it.
 */

import type { Target } from "@wren/core/access";
import type { ChangeLine } from "@wren/core/edits";
import { type FieldMeta, type RecordMeta, SYSTEM } from "@wren/core/records";
import type { ListAsk, RecordAnswer, RecordsPage, Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { can, canAt } from "./access.js";
import { type Action, applies, blockedOf, runningOn, runs, useRun } from "./action.js";
import { Button } from "./controls.js";
import { listChanged } from "./data/delta.js";
import { useLoad, writeThrough } from "./data/query.js";
import { DraftBox, DraftText } from "./draft.js";
import { type LiveText, liveText } from "./draft-save.js";
import {
  ASK_FOCUS,
  ASK_POLL_MS,
  AskClaude,
  EditFields,
  type Editing,
  History,
  thinking,
} from "./edits.js";
import { LoadFailed } from "./feedback.js";
import { type CiteTo, Cue, dateOf, dateTip, FieldCell, FieldLine, relative } from "./fields.js";
import { FoldList, foldOf } from "./fold.js";
import { num } from "./format.js";
import { Why } from "./hint-layer.js";
import { away, NoLink } from "./item-link.js";
import { GROUP_LABEL, PAGE_TITLE } from "./layout.js";
import { TAB, tabTone } from "./list-bar.js";
import { useOpenRecord } from "./palette-scope.js";
import { AskAccess, type IssueLine, RecordIssues, rowTarget } from "./record-access.js";
import { recordHead } from "./record-head.js";
import { detailPatch, patchRecord } from "./record-patch.js";
import { ListSkeleton, ROOT } from "./records-columns.js";
import {
  type ActPatch,
  actsOf,
  cap,
  NO_CALL,
  type Place,
  pressAct,
  type RecordAct,
  type RecordActs,
  type RecordsApi,
  type RecordTemplateProps,
  SHOWN,
  shownKey,
  startOf,
  subtitleCue,
  subtitleOf,
  titleOf,
  useTypes,
  versionIn,
  words,
} from "./records-types.js";
import { SaveScope, useSavePage } from "./save/react.js";
import { recordKey } from "./save/writes.js";
import { SourceCard, SourceList, useSourcePick } from "./sources.js";
import { TabBar } from "./tab-bar.js";
import { DataTable } from "./table.js";

/**
 * A docked action bar floats over the record's foot, so the record ends its height above it:
 * the last lines scroll clear of the buttons.
 */
function dockRoom(bar: HTMLDivElement | null) {
  const article = bar?.closest("article");
  if (!bar || !article) return;
  const fit = () => article.style.setProperty("--dock-h", `${bar.offsetHeight}px`);
  const seen = new ResizeObserver(fit);
  seen.observe(bar);
  return () => {
    seen.disconnect();
    article.style.removeProperty("--dock-h");
  };
}

/** The Record template as its own page: back to the list, then the record. */
export function RecordPage({
  id,
  back,
  wide = false,
  ...props
}: RecordTemplateProps & {
  id: string;
  /** Where the back link leads, when not the list: a record opened inside another page. */
  back?: { href: string; label: string } | undefined;
  /** The page's whole width, not a reading column: an editor. */
  wide?: boolean | undefined;
}) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!meta || !types.data) return <ListSkeleton />;
  return (
    <div className={cn(ROOT, "mx-auto grid gap-4", wide ? "max-w-none" : "max-w-[880px]")}>
      {/* A phone's bar at the top leads back there instead. */}
      <a
        href={back?.href ?? props.place.list}
        className={cn(
          "w-fit text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)",
          !back && "max-[900px]:in-data-[phone-nav]:hidden",
        )}
      >
        ← {back?.label ?? cap(meta.name.many)}
      </a>
      <RecordBody
        meta={meta}
        types={types.data}
        id={id}
        api={props.api}
        place={props.place}
        extras={props.extras}
        acts={props.acts}
        docked
      />
    </div>
  );
}

/** One record: its head, then tabs for details, each related type, activity and sources. */
export function RecordBody({
  meta,
  types,
  id,
  api,
  place,
  extras,
  acts,
  rev = 0,
  onActed,
  docked = false,
}: {
  meta: RecordMeta;
  types: RecordMeta[];
  id: string;
  api: RecordsApi;
  place: Place;
  extras: RecordTemplateProps["extras"];
  acts?: RecordActs | undefined;
  /** Read again when it changes: something acted on this record. */
  rev?: number | undefined;
  onActed?: ((changed: (string | number)[]) => void) | undefined;
  /** In a panel: on a phone its actions sit in a bar at the thumb, not under the title. */
  docked?: boolean | undefined;
}) {
  const got = useLoad(`${meta.id}:${id}:${rev}`, () => api.get({ record: meta.id, id }), api);
  /** An action changed this record: its states wash once they are read again. */
  const [changed, setChanged] = useState(false);
  const acted = (ids: (string | number)[]) => {
    got.retry();
    setChanged(ids.length > 0);
    onActed?.(ids);
  };
  const { run, busy, running, done, dialog } = useRun(acts?.call ?? NO_CALL, acted, meta.name, {
    // What this page draws: a yes names it, so one over newer words is refused.
    versionOf: (rowId) =>
      String(rowId) === id || String(rowId) === String(got.data?.row.id)
        ? (versionIn(got.data?.detail, got.data?.row) ?? version.current.now)
        : null,
  });
  // Issues sit on every record a signed-in login reads, but not on access's own lists.
  const access =
    api.access && acts && !acts.viewer.demo && !meta.id.startsWith("access.") ? api.access : null;
  const issues = useLoad<IssueLine[] | null>(
    `issues:${meta.id}:${id}:${rev}`,
    () => (access ? access.issues({ record: meta.id, id }) : Promise.resolve(null)),
    api,
  );
  /** What's typed in that box now, for a live preview beside it; this record's only. */
  const [typed] = useState(liveText);
  const [lit, pickMark] = useSourcePick();
  const tab = place.params.get("tab") ?? "details";
  const [want, setWant] = useState<string | null>(null);
  // Where this row sits, for what its head may show: the YouTube editor acts on YouTube's alone.
  const here: Target = got.data ? rowTarget(meta, got.data.row, api.access?.client ?? "") : {};
  if (!api.access) delete here.client;
  /** Every box on this record: a head action saves them all first. */
  const boxes = useSavePage();
  const record = recordKey(meta.name.many, id);
  const act: RecordAct = Object.assign(
    async (
      action: string,
      input: Record<string, unknown> = {},
      o: { patch?: ActPatch | undefined } = {},
    ) => {
      const a = actsOf(meta, acts, true, here).find((x) => x.id === action);
      if (!a || !acts || !got.data) throw new Error("You can't do that here.");
      const rowId = got.data.row.id as string | number;
      const out = await pressAct(acts.call, a, rowId, record, input);
      const patch = o.patch;
      // The answer says what changed: the page shows it with no read again.
      if (patch?.(got.data.detail, out))
        writeThrough(
          api,
          detailPatch(meta.id, rowId, (detail) => patch(detail, out)),
        );
      else acted([rowId]);
      return out;
    },
    { record },
  );
  // A type with no `load` still gets its extras, with no detail.
  const more = got.data && extras ? extras(got.data.detail, got.data.row, act, got.at) : {};
  const state = got.data?.edit ?? null;
  /**
   * The version the next edit names: a save's answer moves it at once, before the page draws
   * that answer, so two saves in a row never send the same one. A new read moves it too.
   */
  const version = useRef<{ read: string | null; now: string | null }>({ read: null, now: null });
  if (state && state.version !== version.current.read)
    version.current = { read: state.version, now: state.version };
  const drawn = got.data ? versionIn(got.data.detail, got.data.row) : null;
  useEffect(() => {
    if (!drawn) return;
    const k = shownKey(meta.id, id);
    SHOWN.set(k, drawn);
    return () => {
      if (SHOWN.get(k) === drawn) SHOWN.delete(k);
    };
  }, [meta.id, id, drawn]);
  // Changing it needs `run` here; the server checks it again.
  const mayEdit =
    !!state &&
    !!api.edit &&
    (!acts || can(acts.viewer, { audience: "team", needs: meta.editNeeds ?? "run" }));
  const editing: Editing | null =
    mayEdit && state
      ? {
          save: async (patch, run) => {
            const out = await (api.edit as NonNullable<RecordsApi["edit"]>)({
              record: meta.id,
              id,
              patch,
              expect: version.current.now ?? state.version,
              ...(run ? { run } : {}),
            });
            version.current = { read: out.version, now: out.version };
            // The page shows it now, History line too: a save never reads the record again.
            const keys = Object.keys(patch);
            const fields = Object.fromEntries(
              keys.map((k) => [k, k in out.values ? out.values[k] : patch[k]]),
            );
            const change: ChangeLine | null =
              out.change === null
                ? null
                : {
                    id: out.change,
                    at: new Date().toISOString(),
                    by: "You",
                    via: run ? "claude" : "person",
                    before: Object.fromEntries(keys.map((k) => [k, state.values[k] ?? null])),
                    after: fields,
                    undoes: null,
                    undone: false,
                  };
            patchRecord(api, meta.id, id, fields, { version: out.version, change });
            return out.change;
          },
          undo: async (change) => {
            await api.undo?.({ record: meta.id, id, change });
            acted([id]);
          },
          // A stale save: theirs read again, so Keep mine names the version it now sees.
          reread: () => got.retry(),
          ...(api.ask
            ? {
                ask: async (message: string) => {
                  await api.ask?.({ record: meta.id, id, message });
                  got.retry();
                },
              }
            : {}),
        }
      : null;
  const poll = more.poll ?? (thinking(state) ? ASK_POLL_MS : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new read sets the next one.
  useEffect(() => {
    if (!poll) return;
    const t = setTimeout(got.retry, poll);
    return () => clearTimeout(t);
  }, [got.data]);
  // ⌘K asks about this record; with edits, its answer lands in the Ask box here.
  useOpenRecord(`${meta.id}:${id}:${tab}:${got.data ? 1 : 0}:${editing ? 1 : 0}`, () =>
    got.data
      ? {
          type: meta.id,
          id,
          title: titleOf(meta, got.data.row),
          one: meta.name.one,
          ask: editing?.ask
            ? async (q: string) => {
                if (tab !== "details") place.go(place.link({ tab: null }), true);
                await editing.ask?.(q);
                dispatchEvent(new Event(ASK_FOCUS));
              }
            : undefined,
        }
      : null,
  );
  // A chip on another tab opens the sources, then lights its card once it's drawn.
  useEffect(() => {
    if (want && tab === "sources") {
      pickMark(want);
      setWant(null);
    }
  }, [want, tab, pickMark]);

  if (got.error && !got.data)
    return <LoadFailed error={got.error} onRetry={got.retry} what={meta.name.one} />;
  if (!got.data)
    return (
      <div className="grid gap-3" role="status" aria-busy="true" aria-label="Loading">
        <div className="h-6 w-1/2 animate-pulse bg-(--ui-fill)" />
        <div className="h-4 w-1/3 animate-pulse bg-(--ui-fill)" />
        <div className="mt-4 h-24 w-full animate-pulse bg-(--ui-wash)" />
      </div>
    );
  const { row, related, activity } = got.data;
  const sources = more.sources ?? [];
  const cite: CiteTo = {
    order: sources.map((s) => s.mark.toLowerCase()),
    lit,
    pick: (mark) => {
      if (tab === "sources") return pickMark(mark);
      setWant(mark);
      place.go(place.link({ tab: "sources" }), true);
    },
  };
  // A draft the record holds is its box, not a field.
  const box = more.draft;
  // Fields he edits in place draw once, as their inputs.
  const own = new Set(editing ? (meta.edits ?? []) : []);
  // Long text and states have their own places below; the key facts are the short rest.
  const long = (f: FieldMeta | undefined) =>
    !!f &&
    (f.kind === "status" || f.kind === "prose" || f.kind === "cited" || f.key === box?.field);
  // The header says each field once; the Details below leave out what it shows.
  const { sub, states, keys, shown: inHead } = recordHead(meta, row, long);
  const subCue = subtitleCue(meta, row);
  const folded = foldOf(meta, row);
  // Long text reads as its own section, above the facts.
  const cited = meta.fields.filter(
    (f) =>
      (f.kind === "cited" || f.kind === "prose") &&
      row[f.key] &&
      f.key !== box?.field &&
      !own.has(f.key) &&
      !more.drawn?.includes(f.key),
  );
  /**
   * An empty field says nothing ("Why it stopped" on a draft), so it isn't drawn. A fact named
   * like a field says it better (an address beside its verdict) and takes its place.
   */
  const told = new Set((more.facts ?? []).map(([label]) => label));
  const rest = meta.fields.filter(
    (f) =>
      f.kind !== "cited" &&
      f.kind !== "prose" &&
      f.key !== meta.title &&
      f.key !== box?.field &&
      // The record's version is what a yes names, never a fact to read.
      f.key !== "version" &&
      // A folded row's messages read as their own list.
      f.key !== meta.fold &&
      !own.has(f.key) &&
      row[f.key] != null &&
      row[f.key] !== "" &&
      !inHead.has(f.key) &&
      !told.has(f.label) &&
      !(f.group && more.drawn?.includes(f.group)),
  );
  // Grouped fields after the loose ones, in the order declared; "System" (who, when) folded last.
  const named = [...new Set(rest.map((f) => f.group))].filter(
    (g): g is string => !!g && g !== SYSTEM,
  );
  const system = rest.filter((f) => f.group === SYSTEM);
  const lines = (fields: FieldMeta[]) =>
    fields.map((f) => (
      <Line key={f.key} label={f.label}>
        <FieldLine field={f} cell={row[f.key]} cite={cite} />
      </Line>
    ));
  const shown = actsOf(meta, acts, false, here).filter((a) => applies(a, row));
  const inline = box ? actsOf(meta, acts, true, here).filter((a) => applies(a, row)) : [];
  // A blocked send (a carousel's Approve) leaves the box without one; the head says why.
  const sendAction = box?.send ? shown.find((a) => a.id === box.send && runs(a, row)) : undefined;
  /** A head action runs on what's saved: every box on the page (words, fields, slides) goes first. */
  const runHead = (a: Action) =>
    void boxes.flush().then((ok) => ok && run(a, [row.id], startOf(a, row)));
  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "details", label: "Details" },
    ...related.flatMap((r) => {
      const t = types.find((x) => x.id === r.record);
      return t ? [{ id: t.name.many, label: cap(t.name.many), count: r.count }] : [];
    }),
    ...(activity
      ? [{ id: "activity", label: meta.activityLabel ?? "Activity", count: activity.length }]
      : []),
    ...(state ? [{ id: "history", label: "History", count: state.history.length }] : []),
    ...(access && issues.data
      ? [
          {
            id: "issues",
            label: "Issues",
            count: issues.data.filter((i) => !i.resolvedAt).length,
          },
        ]
      : []),
    ...(more.sources ? [{ id: "sources", label: "Sources", count: sources.length }] : []),
  ];
  const relatedType = types.find(
    (t) => t.name.many === tab && related.some((r) => r.record === t.id),
  );

  const view = (
    <article className="grid gap-5 max-[900px]:pb-(--dock-h,0px)">
      <header className="grid gap-3">
        {more.hero}
        {/* The title keeps a readable width: when the actions don't fit beside it, they wrap
            under it (a sheet with five actions). */}
        <div className="flex flex-wrap items-start justify-between gap-3 max-sm:flex-col">
          <div className="min-w-0 sm:flex-[1_1_16rem]">
            {/* A title with no spaces (a profile link) breaks, not runs under the actions. */}
            <h2 className={`${PAGE_TITLE} wrap-anywhere`}>{titleOf(meta, row)}</h2>
            {sub ? (
              <p className="mt-0.5 text-[14px] text-(--ui-ink-2)">
                {subCue ? (
                  <span className="mr-1.5 inline-flex align-[-0.1em]">
                    <Cue state={subCue} size={15} />
                  </span>
                ) : null}
                {subtitleOf(meta, row)}
              </p>
            ) : null}
          </div>
          {shown.length ? (
            <div
              ref={docked ? dockRoom : undefined}
              className={cn(
                "flex shrink-0 flex-wrap items-center gap-2",
                // A phone: at the thumb. In a sheet it stays at the screen's foot down to half
                // height, moving as the sheet does (--sheet-y), then rides down with it.
                docked &&
                  "max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-10 max-[900px]:border-t max-[900px]:border-(--ui-hair) max-[900px]:[background:linear-gradient(var(--ui-band),var(--ui-band)),var(--ui-paper)] max-[900px]:px-4 max-[900px]:pt-2 max-[900px]:pb-[calc(8px+env(safe-area-inset-bottom))] max-[900px]:[transform:translate3d(0,calc(-1*min(var(--sheet-y,0px),var(--sheet-mid,0px))),0)] max-[900px]:[transition:transform_var(--sheet-t,0ms)_cubic-bezier(0.32,0.72,0,1)] max-[900px]:[&>*]:flex-none",
              )}
            >
              {shown.map((a, i) => (
                <Why
                  key={a.id}
                  text={blockedOf(a, row) ?? (a.key ? a.label : undefined)}
                  keys={blockedOf(a, row) ? undefined : a.key?.toUpperCase()}
                >
                  <Button
                    tone={i === 0 ? "primary" : "secondary"}
                    size={i === 0 ? "next" : "dense"}
                    busy={runningOn(running, a.id, [row.id])}
                    done={runningOn(done, a.id, [row.id])}
                    disabled={busy || !!blockedOf(a, row)}
                    onClick={() => runHead(a)}
                  >
                    {a.label}
                  </Button>
                </Why>
              ))}
              {dialog}
            </div>
          ) : access &&
            !access.readOnly &&
            acts &&
            issues.data &&
            canAt(acts.viewer, "comment", here) ? (
            // Nothing here they may do: raising an issue takes the actions' place.
            <Button
              tone="secondary"
              size="dense"
              className="shrink-0"
              onClick={() => place.go(place.link({ tab: "issues" }), true)}
            >
              Raise issue
            </Button>
          ) : null}
        </div>
        {shown.map((a) => {
          const why = blockedOf(a, row);
          return why ? (
            <p key={a.id} className="m-0 text-[13px] text-(--ui-ink-2)">
              {why}
            </p>
          ) : null;
        })}
        {states.length ? (
          <div
            onAnimationEnd={(e) => {
              if (e.animationName === "ui-changed") setChanged(false);
            }}
            className={cn(
              "-mx-2 -my-1 flex flex-wrap gap-x-4 gap-y-1 rounded-(--ui-radius) px-2 py-1 text-[13px]",
              changed && !got.loading && "animate-ui-changed",
            )}
          >
            {states.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1.5">
                <span className="text-(--ui-ink-2)">{f.label}</span>
                <FieldCell field={f} cell={row[f.key]} />
              </span>
            ))}
          </div>
        ) : null}
        {access && acts ? (
          <AskAccess meta={meta} row={row} access={access} viewer={acts.viewer} />
        ) : null}
        {keys.length ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-(--ui-hair) py-3 sm:grid-cols-4">
            {keys.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-[12px] text-(--ui-ink-2)">{f.label}</dt>
                <dd
                  // A fact wraps, never cut: tags at their commas ("Sends messages, Spends
                  // money"), an address anywhere ("dana@northwind.example" stays whole).
                  className="mt-0.5 text-[18px] leading-6 font-semibold tracking-[-0.01em] text-pretty [overflow-wrap:anywhere]"
                >
                  <FieldCell field={f} cell={row[f.key]} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>
      {more.top}

      <nav className="relative flex gap-0.5 overflow-x-auto pb-1.5" aria-label="Sections">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={place.link({ tab: t.id === "details" ? null : t.id })}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(TAB, tabTone(tab === t.id))}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="text-(--ui-ink-3)">{num(t.count)}</span>
            ) : null}
            {tab === t.id ? <TabBar row={`sections:${meta.id}`} /> : null}
          </a>
        ))}
      </nav>

      {tab === "activity" && activity ? (
        <Activity
          lines={activity}
          one={meta.name.one}
          empty={meta.activityEmpty}
          links={!!meta.activityLinks}
        />
      ) : tab === "history" && state ? (
        <History meta={meta} lines={state.history} values={state.values} editing={editing} />
      ) : tab === "issues" && access && acts && issues.data ? (
        <RecordIssues
          meta={meta}
          row={row}
          title={titleOf(meta, row)}
          access={access}
          viewer={acts.viewer}
          lines={issues.data}
          reload={issues.retry}
        />
      ) : tab === "sources" ? (
        sources.length ? (
          <SourceList>
            {sources.map((s, i) => (
              <SourceCard
                key={s.mark}
                id={`src-${s.mark.toLowerCase()}`}
                n={i + 1}
                kind={s.kind}
                meta={s.meta}
                title={s.title}
                sure={s.sure}
                detail={s.detail}
                link={s.link}
                lit={lit === s.mark.toLowerCase()}
              />
            ))}
          </SourceList>
        ) : (
          <Quiet>
            What research finds about this {meta.name.one} shows here, each with its link.
          </Quiet>
        )
      ) : relatedType ? (
        <Related meta={relatedType} of={{ record: meta.id, id }} api={api} one={meta.name.one} />
      ) : (
        <Beside aside={more.aside} text={typed}>
          {/* What a draft answers (their words, the thread so far) reads before it. */}
          {more.lead}
          {box ? null : more.form}
          {editing && state ? (
            <>
              <EditFields
                meta={meta}
                id={id}
                at={got.at}
                state={state}
                editing={editing}
                read={(f) =>
                  row[f.key] != null && row[f.key] !== "" ? (
                    <FieldLine field={f} cell={row[f.key]} cite={cite} />
                  ) : null
                }
              />
              {editing.ask ? (
                <AskClaude meta={meta} id={id} turns={state.asks} editing={editing} />
              ) : null}
            </>
          ) : null}
          {folded && meta.fold && !more.drawn?.includes(meta.fold) ? (
            <section className="grid gap-1.5">
              <h3 className={GROUP_LABEL}>Their messages, newest first</h3>
              <FoldList messages={folded} current={String(row.id)} />
            </section>
          ) : null}
          {cited.map((f) => (
            <section key={f.key} className="grid gap-1.5">
              <h3 className={GROUP_LABEL}>{f.label}</h3>
              <p className="text-[14px] leading-[1.65] text-pretty whitespace-pre-line">
                <FieldLine field={f} cell={row[f.key]} cite={cite} />
              </p>
            </section>
          ))}
          {box ? (
            <DraftBox
              key={String(row.id)}
              draft={box}
              id={row.id}
              actions={inline}
              call={acts?.call ?? NO_CALL}
              changed={acted}
              wrote={(text, v) =>
                patchRecord(api, meta.id, row.id as string | number, {
                  [box.field]: text,
                  ...(v ? { version: v } : {}),
                })
              }
              at={got.at}
              send={sendAction ? () => runHead(sendAction) : undefined}
              sending={
                sendAction
                  ? {
                      record: recordKey(meta.name.many, row.id as string | number),
                      what: sendAction.id,
                    }
                  : undefined
              }
              between={more.form}
              framed={!more.aside}
              onText={more.aside ? typed.set : undefined}
            />
          ) : null}
          {rest.some((f) => !f.group) || more.facts?.length ? (
            <dl className={DL}>
              {lines(rest.filter((f) => !f.group))}
              {(more.facts ?? []).map(([label, value]) => (
                <Line key={label} label={label}>
                  {value}
                </Line>
              ))}
            </dl>
          ) : null}
          {named.map((g) => (
            <section key={g} className="grid gap-1.5">
              <h3 className={GROUP_LABEL}>{g}</h3>
              <dl className={DL}>{lines(rest.filter((f) => f.group === g))}</dl>
            </section>
          ))}
          {system.length ? (
            <details className="group/system">
              <summary className="w-fit cursor-pointer text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
                {SYSTEM}
              </summary>
              <dl className={cn(DL, "mt-1.5")}>{lines(system)}</dl>
            </details>
          ) : null}
          {(more.sections ?? []).map(([title, body]) => (
            <section key={title} className="grid gap-2">
              <h3 className={GROUP_LABEL}>{title}</h3>
              {body}
            </section>
          ))}
        </Beside>
      )}
    </article>
  );
  return <SaveScope page={boxes}>{view}</SaveScope>;
}

/**
 * The details, with the record's live preview beside them when it has one: on a wide page the
 * preview is the right column and stays in view while the fields scroll; on a narrow one it sits
 * above them, folded behind a Preview button so the fields stay near the top.
 */
function Beside({
  aside,
  text,
  children,
}: {
  aside: ReactNode;
  text: LiveText;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!aside) return <div className="grid gap-6">{children}</div>;
  return (
    <DraftText.Provider value={text}>
      <div className="@container/record">
        <div
          // Two columns once the record has room for both: about a 1100 px window beside the nav.
          className="grid gap-4 @min-[760px]/record:grid-cols-[minmax(0,1fr)_minmax(0,360px)] @min-[760px]/record:gap-x-10"
        >
          <div className="grid min-w-0 content-start gap-3 @min-[760px]/record:sticky @min-[760px]/record:top-4 @min-[760px]/record:col-start-2 @min-[760px]/record:row-start-1 @min-[760px]/record:max-h-[calc(100dvh-2rem)] @min-[760px]/record:self-start @min-[760px]/record:overflow-y-auto">
            <Button
              tone="secondary"
              size="dense"
              className="w-fit @min-[760px]/record:hidden"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide preview" : "Preview"}
            </Button>
            <div className={open ? "min-w-0" : "hidden min-w-0 @min-[760px]/record:block"}>
              {aside}
            </div>
          </div>
          <div className="grid min-w-0 content-start gap-6 @min-[760px]/record:col-start-1 @min-[760px]/record:row-start-1">
            {children}
          </div>
        </div>
      </div>
    </DraftText.Provider>
  );
}

/** A record's facts as label and value, no frame and no rules (the artifact's `.pk dl`). */
const DL = "m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13.5px]";

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-(--ui-ink-3)">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Nothing here yet: a dashed box, so it reads as a place that fills, not as stray text. */
export function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-(--ui-edge) bg-(--ui-wash) px-4 py-6 text-[14px] text-(--ui-ink-2)">
      {children}
    </p>
  );
}

/** What happened to a record, newest first. */
function Activity({
  lines,
  one,
  empty,
  links,
}: {
  lines: RecordAnswer["activity"] & object;
  one: string;
  empty?: string | undefined;
  /** Each line opens its own page, or says it has none and offers where it sits. */
  links?: boolean;
}) {
  if (!lines.length)
    return (
      <Quiet>
        {empty ?? `Emails, replies and findings about this ${one} show here as they happen.`}
      </Quiet>
    );
  return (
    <ol className="grid">
      {lines.map((l, i) => {
        const d = dateOf(l.at);
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat; their order is their identity.
            key={i}
            className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-(--ui-hair) py-2.5"
          >
            <time
              dateTime={d?.toISOString()}
              {...(d ? dateTip(d) : {})}
              className="text-[13px] text-(--ui-ink-3)"
            >
              {d ? relative(d) : ""}
            </time>
            <span className="min-w-0 text-[14px]">
              {l.kind ? <span className="font-medium">{words(l.kind)}</span> : null}
              {l.kind && l.what ? <span className="text-(--ui-ink-3)"> · </span> : null}
              <span className="text-(--ui-ink-2)">{l.what}</span>
              {links && l.link ? (
                <>
                  <span className="text-(--ui-ink-3)"> · </span>
                  <a
                    href={l.link}
                    {...(away(l.link) ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
                  >
                    Open it
                  </a>
                </>
              ) : null}
              {links && !l.link ? (
                <NoLink note="No link for this one" context={l.context} className="mt-0.5" />
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A small list of a related type, pointing at this record. */
function Related({
  meta,
  of,
  api,
  one,
}: {
  meta: RecordMeta;
  of: { record: string; id: string };
  api: RecordsApi;
  one: string;
}) {
  const sort = meta.views[0]?.sort;
  const ask: ListAsk = { record: meta.id, of, limit: 25, ...(sort ? { sort } : {}) };
  const page = useLoad<RecordsPage>(
    JSON.stringify(ask),
    (before) => listChanged((a) => api.list(a), ask, before),
    api,
  );
  if (page.error && !page.data) return <LoadFailed error={page.error} onRetry={page.retry} />;
  if (!page.data) return <div className="h-24 w-full animate-pulse bg-(--ui-wash)" />;
  if (!page.data.rows.length)
    return (
      <Quiet>
        {cap(meta.name.many)} for this {one} show here.
      </Quiet>
    );
  const cols = meta.fields.filter((f) => f.column).slice(0, 4);
  return (
    <DataTable
      look="plain"
      data={page.data.rows}
      rowKey={(r) => String(r.id)}
      columns={cols.map((f) => ({
        key: f.key,
        label: f.label,
        end: f.column?.align === "end",
        cell: (r: Row) => <FieldCell field={f} cell={r[f.key]} />,
      }))}
    />
  );
}
