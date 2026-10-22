/**
 * Journeys → Board (designs/2026-10-19-business-map.md): one board for the shape, a column per
 * node that holds people (every node but a source), by depth then name, a card per open journey.
 * Drag a card down a flow edge to move it, or pick the node on a phone. A move goes to the shape's
 * own `move` step through the `Journeys` service, so a workflow that hears it runs. A card only
 * goes where a flow path leads. A journey on a node the newest version dropped (a ghost) sits in
 * its own column. Drag a card to the drop zone, or press Drop, to end it with a reason.
 */
import type { RecordAnswer, RecordsPage, Row } from "@wren/core/records/serve";
import { pathOf, type ShapeBody } from "@wren/pipeline/model";
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
import { href } from "../../route.js";

const SHAPE = "pipeline.shape";
const JOURNEY = "pipeline.journey";
const MIME = "text/journey";
/** Rows one read takes (the server's cap), and how many reads one board makes at most. */
const PAGE = 200;
const PAGES = 5;
/** Finished journeys shown in their node's column. */
const RECENT_DONE = 20;

/** The body's client: none in Wren's workspace, whose journeys the server keeps as Wren's. */
export const atOf = (client: string): Record<string, string> =>
  client === WREN.id ? {} : { client };

/** A column: a node that holds people. */
interface Column {
  id: string;
  name: string;
  /** An offer node: reaching it is a sale. */
  sale: boolean;
}
interface Shape {
  body: ShapeBody;
  columns: Column[];
}
interface Journey {
  id: string;
  name: string;
  node: string;
  nodeName: string;
  status: string;
  flag: string | null;
  /** On an older version whose node the newest shape lacks. */
  ghost: boolean;
  entry: string | null;
  owner: string | null;
  daysAtNode: number;
}

const text = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const journeyOf = (r: Row): Journey => ({
  id: String(r.id),
  name: text(r.name) ?? String(r.id),
  node: text(r.node) ?? "",
  nodeName: text(r.nodeName) ?? text(r.node) ?? "",
  status: text(r.status) ?? "open",
  flag: text(r.flag),
  ghost: text(r.ghost) === "ghost",
  entry: text(r.entry),
  owner: text(r.owner),
  daysAtNode: Number(r.daysAtNode ?? 0),
});

/** The shape's columns: every node but a source, by depth, then name. Null when it has none. */
const readShape = async (at: Record<string, string>): Promise<Shape | null> => {
  const got = await call<RecordAnswer>("pipeline/recordsGet", {
    ...at,
    record: SHAPE,
    id: "shape",
  });
  const detail = got.detail as { body?: ShapeBody; depths?: Record<string, number> } | null;
  const body = detail?.body;
  if (!body) return null;
  const depths = detail.depths ?? {};
  const columns = body.nodes
    .filter((n) => n.kind !== "source")
    .sort((a, b) => (depths[a.id] ?? 0) - (depths[b.id] ?? 0) || a.name.localeCompare(b.name))
    .map((n) => ({ id: n.id, name: n.name, sale: n.kind === "offer" }));
  return { body, columns };
};

/** The open journeys, longest at their node first, and the few newest finished ones. */
const readJourneys = async (
  at: Record<string, string>,
): Promise<{ open: Journey[]; done: Journey[] }> => {
  const done = call<RecordsPage>("pipeline/recordsList", {
    ...at,
    record: JOURNEY,
    where: { status: "done" },
    sort: "-closedAt",
    limit: RECENT_DONE,
  });
  const open: Journey[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const page = await call<RecordsPage>("pipeline/recordsList", {
      ...at,
      record: JOURNEY,
      where: { status: "open" },
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
  const shape = useCall(`journeys-board:shape:${JSON.stringify(at)}`, () => readShape(at));
  const got = useCall(`journeys-board:journeys:${JSON.stringify(at)}`, () => readJourneys(at));
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
        Object.entries(m).filter(([id, node]) => {
          const now = data.open.find((j) => j.id === id);
          return now ? now.node !== node : !data.done.some((j) => j.id === id);
        }),
      );
      return Object.keys(left).length === Object.keys(m).length ? m : left;
    });
    setGone((g) => {
      const left = new Set([...g].filter((id) => data.open.some((j) => j.id === id)));
      return left.size === g.size ? g : left;
    });
  }, [data]);
  const failed = shape.error && !shape.data ? shape : got.error && !got.data ? got : null;
  if (failed?.error) return <LoadFailed error={failed.error} onRetry={failed.retry} />;
  if (shape.data === undefined || !data) return <Loading lines={6} />;

  const header = (
    <PageHeader
      title="Board"
      lede="Drag a person to the node they are at now. A workflow can start on any move."
    />
  );
  if (!shape.data) {
    return (
      <>
        {header}
        <Empty>No shape yet.</Empty>
      </>
    );
  }

  const { body, columns: cols } = shape.data;
  const write = !props.demo;
  const open = data.open
    .filter((j) => !gone.has(j.id))
    .map((j) => {
      const to = moved[j.id];
      const name = cols.find((c) => c.id === to)?.name;
      return to ? { ...j, node: to, nodeName: name ?? j.nodeName } : j;
    });
  // A journey on a node the newest version no longer has (an older version): its own column.
  const other = [
    ...new Map(
      open.filter((j) => !cols.some((c) => c.id === j.node)).map((j) => [j.node, j.nodeName]),
    ),
  ];

  const move = (id: string, to: string) => {
    const j = open.find((x) => x.id === id);
    if (!j || j.node === to) return;
    // A ghost moves by its own version's edges, which only the server holds.
    if (!j.ghost && !pathOf(body, j.node, to, { loops: false })) {
      setNote(
        `${j.name} cannot go from ${j.nodeName} to ${nameOf(cols, to)}: no path leads there.`,
      );
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
      {header}
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
        {cols.map((c) => {
          const here = open.filter((j) => j.node === c.id);
          const finished = data.done.filter((j) => j.node === c.id);
          return (
            <Lane
              key={c.id}
              name={c.name}
              count={here.length + finished.length}
              tone={c.sale ? "good" : undefined}
              write={write}
              mime={MIME}
              onDropId={(id) => move(id, c.id)}
              empty={write ? "Drop a person here." : "None."}
            >
              {here.map((j) => (
                <Card
                  key={j.id}
                  j={j}
                  at={at}
                  body={body}
                  columns={cols}
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
                  body={body}
                  columns={cols}
                  write={false}
                  move={move}
                  ask={() => {}}
                />
              ))}
            </Lane>
          );
        })}
        {other.map(([id, name]) => (
          <Lane
            key={id}
            name={`${name} (older version)`}
            count={open.filter((j) => j.node === id).length}
            tone="faint"
            write={false}
            mime={MIME}
            onDropId={() => {}}
            empty="None."
          >
            {open
              .filter((j) => j.node === id)
              .map((j) => (
                <Card
                  key={j.id}
                  j={j}
                  at={at}
                  body={body}
                  columns={cols}
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

const nameOf = (cols: readonly Column[], id: string) => cols.find((c) => c.id === id)?.name ?? id;

function Card({
  j,
  at,
  body,
  columns,
  write,
  move,
  ask,
}: {
  j: Journey;
  at: Record<string, string>;
  body: ShapeBody;
  columns: readonly Column[];
  write: boolean;
  move: (id: string, to: string) => void;
  ask: () => void;
}) {
  const done = j.status === "done";
  // The nodes a flow path leads to from here; a ghost's own edges are the server's to read.
  const reach = j.ghost
    ? columns
    : columns.filter((c) => pathOf(body, j.node, c.id, { loops: false }));
  return (
    <article
      draggable={write}
      onDragStart={(e) => dragStart(e, MIME, j.id)}
      className={cx(
        // One track that may shrink: a long name cuts in the card, never past its lane.
        "grid grid-cols-[minmax(0,1fr)] gap-1 border border-(--ui-hair) bg-(--ui-paper) p-2.5 text-[13px]",
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
          {j.daysAtNode === 0 ? "Today" : `${num(j.daysAtNode)}d`}
          {done ? " ago" : " here"}
        </span>
        {j.flag === "stale" ? <span className="font-medium text-(--ui-bad)">Stale</span> : null}
        {j.ghost ? <span className="font-medium">Older version</span> : null}
        {j.entry ? (
          <span className="max-w-full truncate" {...clipProps()}>
            {j.entry}
          </span>
        ) : null}
        {j.owner ? (
          <span className="max-w-full truncate" {...clipProps()}>
            {j.owner}
          </span>
        ) : null}
      </div>
      {write ? (
        <div className="mt-1 flex items-center gap-2">
          <select
            aria-label={`Node of ${j.name}`}
            className={cx(SELECT, "min-w-0 flex-1 sm:hidden")}
            value={j.node}
            onChange={(e) => move(j.id, e.target.value)}
          >
            <option value={j.node}>{j.nodeName}</option>
            {reach
              .filter((c) => c.id !== j.node)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
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
        label={`Why does ${journey.name} leave?`}
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
