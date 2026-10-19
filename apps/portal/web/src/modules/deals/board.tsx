/**
 * Journeys → Board (designs/2026-10-18-journeys.md, "Folding `@wren/deals`"): one board per
 * funnel, a column per stage of its newest version, a card per open journey. Drag a card to a
 * later stage to move it, or pick the stage on a phone. A move goes to the funnel's own `move`
 * step through the `Journeys` service, so a workflow that hears it runs. A card only goes forward.
 * Drag it to the drop zone, or press Drop, to end it with a reason.
 */
import type { RecordAnswer, RecordsPage, Row } from "@wren/core/records/serve";
import {
  ACTIONS,
  Button,
  clipProps,
  cx,
  Empty,
  FormKept,
  LoadFailed,
  Loading,
  num,
  PageHeader,
  say,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { dragStart, Lane, SELECT } from "../../kanban.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { go, href } from "../../route.js";

const FUNNEL = "pipeline.funnel";
const JOURNEY = "pipeline.journey";
const MIME = "text/journey";
/** Rows one read takes (the server's cap), and how many reads one board makes at most. */
const PAGE = 200;
const PAGES = 5;
/** Finished journeys shown in the last column. */
const RECENT_DONE = 20;

/** The body's client: none in Wren's workspace, whose journeys the server keeps as Wren's. */
export const atOf = (client: string): Record<string, string> =>
  client === WREN.id ? {} : { client };

interface FunnelRow {
  id: string;
  name: string;
  status: string;
}
interface Stage {
  key: string;
  label: string;
  sale: boolean;
}
interface Journey {
  id: string;
  name: string;
  stage: string;
  stageLabel: string;
  status: string;
  flag: string | null;
  entry: string | null;
  owner: string | null;
  daysInStage: number;
}

const text = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const funnelOf = (r: Row): FunnelRow => ({
  id: String(r.id),
  name: text(r.name) ?? String(r.id),
  status: text(r.status) ?? "live",
});
const journeyOf = (r: Row): Journey => ({
  id: String(r.id),
  name: text(r.name) ?? String(r.id),
  stage: text(r.stage) ?? "",
  stageLabel: text(r.stageLabel) ?? text(r.stage) ?? "",
  status: text(r.status) ?? "open",
  flag: text(r.flag),
  entry: text(r.entry),
  owner: text(r.owner),
  daysInStage: Number(r.daysInStage ?? 0),
});

const readFunnels = async (at: Record<string, string>): Promise<FunnelRow[]> => {
  const page = await call<RecordsPage>("pipeline/recordsList", {
    ...at,
    record: FUNNEL,
    view: "all",
    limit: PAGE,
  });
  return page.rows.map(funnelOf);
};

const readStages = async (at: Record<string, string>, funnel: string): Promise<Stage[]> => {
  const got = await call<RecordAnswer>("pipeline/recordsGet", {
    ...at,
    record: FUNNEL,
    id: funnel,
  });
  const stages = (got.detail as { stages?: Stage[] } | null)?.stages ?? [];
  return stages.map((s) => ({ key: s.key, label: s.label, sale: s.sale === true }));
};

/** A funnel's open journeys, longest in their stage first, and its few newest finished ones. */
const readJourneys = async (
  at: Record<string, string>,
  funnel: string,
): Promise<{ open: Journey[]; done: Journey[] }> => {
  const done = call<RecordsPage>("pipeline/recordsList", {
    ...at,
    record: JOURNEY,
    where: { funnel, status: "done" },
    sort: "-closedAt",
    limit: RECENT_DONE,
  });
  const open: Journey[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const page = await call<RecordsPage>("pipeline/recordsList", {
      ...at,
      record: JOURNEY,
      where: { funnel, status: "open" },
      sort: "movedAt",
      limit: PAGE,
      ...(cursor ? { cursor } : {}),
    });
    open.push(...page.rows.map(journeyOf));
    if (!page.next) break;
    cursor = page.next;
  }
  return { open, done: (await done).rows.map(journeyOf) };
};

export function JourneyBoard(props: PageProps) {
  const at = atOf(props.client);
  const funnels = useCall(`journeys-board:funnels:${props.client}`, () => readFunnels(at));
  if (funnels.error && !funnels.data)
    return <LoadFailed error={funnels.error} onRetry={funnels.retry} />;
  if (!funnels.data) return <Loading lines={6} />;
  const list = funnels.data;
  const funnel =
    list.find((f) => f.id === props.params.get("funnel")) ??
    list.find((f) => f.status === "live") ??
    list[0];
  return (
    <>
      <PageHeader
        title="Board"
        lede="Drag a person to the stage they are in now. A workflow can start on any move."
        actions={
          list.length > 1 && funnel ? (
            <select
              aria-label="Funnel"
              className={SELECT}
              value={funnel.id}
              onChange={(e) => go("/pipelines/board", { funnel: e.target.value }, props.params)}
            >
              {list.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.status === "live" ? "" : " (off)"}
                </option>
              ))}
            </select>
          ) : null
        }
      />
      {funnel ? (
        <FunnelBoard key={funnel.id} {...props} at={at} funnel={funnel} />
      ) : (
        <Empty>No funnels yet.</Empty>
      )}
    </>
  );
}

function FunnelBoard({
  at,
  funnel,
  demo,
}: PageProps & { at: Record<string, string>; funnel: FunnelRow }) {
  const stages = useCall(`journeys-board:stages:${JSON.stringify(at)}:${funnel.id}`, () =>
    readStages(at, funnel.id),
  );
  const got = useCall(`journeys-board:journeys:${JSON.stringify(at)}:${funnel.id}`, () =>
    readJourneys(at, funnel.id),
  );
  // A move shows at once and holds until a read agrees, so an older read never drags it back.
  const [moved, setMoved] = useState<Record<string, string>>({});
  // A drop shows at once too: the card leaves, and comes back if the server refuses.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // One move per journey at a time, in the order made: the last one lands last.
  const queue = useRef(new Map<string, Promise<void>>());
  const data = got.data;
  useEffect(() => {
    if (!data) return;
    setMoved((m) => {
      const left = Object.fromEntries(
        Object.entries(m).filter(([id, stage]) => {
          const now = data.open.find((j) => j.id === id);
          return now ? now.stage !== stage : !data.done.some((j) => j.id === id);
        }),
      );
      return Object.keys(left).length === Object.keys(m).length ? m : left;
    });
    setGone((g) => {
      const left = new Set([...g].filter((id) => data.open.some((j) => j.id === id)));
      return left.size === g.size ? g : left;
    });
  }, [data]);
  const failed = stages.error && !stages.data ? stages : got.error && !got.data ? got : null;
  if (failed?.error) return <LoadFailed error={failed.error} onRetry={failed.retry} />;
  if (!stages.data || !data) return <Loading lines={6} />;

  const cols = stages.data;
  const write = !demo && funnel.status === "live";
  const open = data.open
    .filter((j) => !gone.has(j.id))
    .map((j) => {
      const to = moved[j.id];
      const label = cols.find((s) => s.key === to)?.label;
      return to ? { ...j, stage: to, stageLabel: label ?? j.stageLabel } : j;
    });
  const indexOf = (key: string) => cols.findIndex((s) => s.key === key);
  // A journey on a stage the newest version no longer has (an older version): its own column.
  const other = [
    ...new Map(open.filter((j) => indexOf(j.stage) < 0).map((j) => [j.stage, j.stageLabel])),
  ];
  const last = cols.at(-1)?.key;

  const move = (id: string, to: string) => {
    const j = open.find((x) => x.id === id);
    if (!j || j.stage === to) return;
    const from = indexOf(j.stage);
    if (from >= 0 && indexOf(to) >= 0 && indexOf(to) < from) {
      setNote(`A journey only moves forward. ${j.name} is at ${j.stageLabel}.`);
      return;
    }
    setNote(null);
    setMoved((m) => ({ ...m, [id]: to }));
    const before = queue.current.get(id) ?? Promise.resolve();
    const next = before.then(async () => {
      try {
        await ACTIONS.run(`journey-move:${id}:${to}`, (requestId) =>
          call("pipeline/journeysMove", { ...at, journey: id, to, requestId }),
        );
        if (queue.current.get(id) === next) got.retry();
      } catch (err) {
        // Back to where the server has it, unless a later move took over.
        setMoved((m) => {
          if (m[id] !== to) return m;
          const { [id]: _, ...rest } = m;
          return rest;
        });
        setNote(err instanceof Error ? err.message : String(err));
        say.failed(err);
      }
    });
    queue.current.set(id, next);
  };

  const dropped = asking ? data.open.find((j) => j.id === asking) : undefined;
  const drop = async (id: string, reason: string) => {
    setNote(null);
    setGone((g) => new Set(g).add(id));
    try {
      await ACTIONS.run(`journey-drop:${id}`, (requestId) =>
        call("pipeline/journeysDrop", { ...at, journey: id, reason, requestId }),
      );
      say.done("Dropped.");
      setAsking(null);
      got.retry();
    } catch (err) {
      setGone((g) => {
        const left = new Set(g);
        left.delete(id);
        return left;
      });
      setNote(err instanceof Error ? err.message : String(err));
      say.failed(err);
      return false;
    }
  };

  return (
    <>
      {funnel.status === "live" ? null : (
        <p className="mb-3 text-[13.5px] text-(--ui-ink-2)">
          This funnel is off, so nobody moves. Turn it on to move people.
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className={cx("m-0", note && "mb-3 text-[13.5px] text-(--ui-bad)")}
      >
        {note}
      </p>
      {write && dropped ? (
        <DropForm
          key={dropped.id}
          journey={dropped}
          onDrop={drop}
          onCancel={() => setAsking(null)}
        />
      ) : null}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
        {cols.map((s) => {
          const here = open.filter((j) => j.stage === s.key);
          const finished = s.key === last ? data.done : [];
          return (
            <Lane
              key={s.key}
              name={s.label}
              count={here.length + finished.length}
              tone={s.sale ? "good" : undefined}
              write={write}
              mime={MIME}
              onDropId={(id) => move(id, s.key)}
              empty={write ? "Drop a person here." : "None."}
            >
              {here.map((j) => (
                <Card
                  key={j.id}
                  j={j}
                  at={at}
                  stages={cols}
                  write={write}
                  move={move}
                  ask={() => setAsking(j.id)}
                />
              ))}
              {finished.map((j) => (
                <Card
                  key={j.id}
                  j={j}
                  at={at}
                  stages={cols}
                  write={false}
                  move={move}
                  ask={() => {}}
                />
              ))}
            </Lane>
          );
        })}
        {other.map(([key, label]) => (
          <Lane
            key={key}
            name={`${label} (older version)`}
            count={open.filter((j) => j.stage === key).length}
            tone="faint"
            write={false}
            mime={MIME}
            onDropId={() => {}}
            empty="None."
          >
            {open
              .filter((j) => j.stage === key)
              .map((j) => (
                <Card
                  key={j.id}
                  j={j}
                  at={at}
                  stages={cols}
                  write={write}
                  move={move}
                  ask={() => setAsking(j.id)}
                />
              ))}
          </Lane>
        ))}
      </div>
      {write ? (
        <section
          aria-label="Drop zone"
          className="grid place-items-center border border-dashed border-(--ui-hair) p-3 text-[13px] text-(--ui-ink-2)"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(MIME);
            if (id) setAsking(id);
          }}
        >
          Drag a person here to end their journey.
        </section>
      ) : null}
    </>
  );
}

function Card({
  j,
  at,
  stages,
  write,
  move,
  ask,
}: {
  j: Journey;
  at: Record<string, string>;
  stages: readonly Stage[];
  write: boolean;
  move: (id: string, to: string) => void;
  ask: () => void;
}) {
  const done = j.status === "done";
  const from = stages.findIndex((s) => s.key === j.stage);
  return (
    <article
      draggable={write}
      onDragStart={(e) => dragStart(e, MIME, j.id)}
      className={cx(
        "grid gap-1 border border-(--ui-hair) bg-(--ui-paper) p-2.5 text-[13px]",
        write && "cursor-grab active:cursor-grabbing",
      )}
    >
      <a
        className="min-w-0 truncate font-medium text-(--ui-ink) no-underline hover:underline"
        href={href(`/pipelines/journeys/${encodeURIComponent(j.id)}`, at)}
        draggable={false}
        {...clipProps()}
      >
        {j.name}
      </a>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-(--ui-ink-3)">
        <span>
          {done ? "Done " : ""}
          {j.daysInStage === 0 ? "Today" : `${num(j.daysInStage)}d`}
          {done ? " ago" : " in stage"}
        </span>
        {j.flag === "stale" ? <span className="font-medium text-(--ui-bad)">Stale</span> : null}
        {j.entry ? (
          <span className="truncate" {...clipProps()}>
            {j.entry}
          </span>
        ) : null}
        {j.owner ? (
          <span className="truncate" {...clipProps()}>
            {j.owner}
          </span>
        ) : null}
      </div>
      {write ? (
        <div className="mt-1 flex items-center gap-2">
          <select
            aria-label={`Stage of ${j.name}`}
            className={cx(SELECT, "min-w-0 flex-1 sm:hidden")}
            value={j.stage}
            onChange={(e) => move(j.id, e.target.value)}
          >
            {(from >= 0 ? stages.slice(from) : []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
            {from < 0 ? <option value={j.stage}>{j.stageLabel}</option> : null}
          </select>
          <Button tone="quiet" size="dense" aria-label={`Drop ${j.name}`} onClick={ask}>
            Drop
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function DropForm({
  journey,
  onDrop,
  onCancel,
}: {
  journey: Journey;
  onDrop: (id: string, reason: string) => Promise<false | undefined>;
  onCancel: () => void;
}) {
  const form = useEditForm({ key: `journey-drop:${journey.id}`, defaults: { reason: "" } });
  const submit = form.onSend(({ reason }) => onDrop(journey.id, reason.trim()), { clear: true });
  return (
    <form
      aria-label={`Drop ${journey.name}`}
      onSubmit={(e) => void submit(e)}
      className="mb-4 flex flex-wrap items-end gap-2 border border-(--ui-hair) p-3"
    >
      <TextField
        form={form}
        name="reason"
        label={`Why does ${journey.name} leave the funnel?`}
        className="grid min-w-[260px] gap-1 text-[13px]"
        required
        autoFocus
      />
      <Button
        tone="primary"
        type="submit"
        size="sm"
        busy={form.formState.isSubmitting}
        disabled={!form.watch("reason").trim()}
      >
        Drop
      </Button>
      <Button tone="quiet" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <FormKept form={form} what="reason" />
    </form>
  );
}
