/**
 * Executions: each subject's walk through a workflow. The list says where each one is now and
 * how long since it entered; opening one lights its path on the canvas, and a card shows the
 * data that came in and what its step sent on. A failed step says why, with Retry for the team.
 * Read and Retry work on a phone.
 */
import { wordsOf } from "@wren/core/models/labels";
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import {
  Button,
  cx,
  Empty,
  Graph,
  Input,
  LoadFailed,
  Loading,
  relative,
  StateMark,
  tipProps,
  whenTip,
} from "@wren/ui";
import { useMemo, useState } from "react";
import { call } from "../../api.js";
import { useCall, useSettled } from "../../load.js";
import type { ListPage } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import type { Drawn } from "../marketplace/boxes.js";
import { QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";
import { graphOf, type Where } from "./canvas.js";
import {
  age,
  cardOf,
  dataText,
  type ExecutionRow,
  forText,
  litNodes,
  type TraceStep,
  traceOf,
} from "./trace.js";

const NOWHERE: Where = { canvas: () => undefined, rows: () => undefined };
const STATES = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "failed", label: "Failed" },
  { id: "done", label: "Done" },
] as const;
const STATE = {
  failed: { label: "Failed", tone: "bad" },
  waiting: { label: "Waiting", tone: "warn" },
  done: { label: "Done", tone: "good" },
} as const;
const PRE =
  "m-0 max-h-[260px] overflow-auto border border-(--ui-hair) bg-(--ui-tile) p-2.5 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-all text-(--ui-ink)";

/** A time as he reads it: "Oct 6, 3:04 PM". */
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** What retrying needs: `effect`, since the step may send. Left out (a preview), the server says. */
const mayRetry = (can: readonly string[] | undefined) => !can || can.includes("effect");

/** A workflow's drawing, as the console draws it. */
export function useDrawn(id: string | null, client: string | null) {
  return useCall(`drawn:${client ?? ""}:${id ?? ""}`, async () =>
    id
      ? call<RecordAnswer>("console/recordsGet", {
          record: "console.component",
          id,
          ...(client ? { client } : {}),
        }).then((a) => (a.detail as { workflow?: Drawn } | null)?.workflow ?? null)
      : null,
  );
}

/** The executions pane on a workflow's canvas: the list on the left, the one opened lit beside it. */
export function Executions({
  w,
  params,
  can,
}: {
  w: Drawn;
  params: URLSearchParams;
  can: readonly string[] | undefined;
}) {
  const view = params.get("runs") ?? "all";
  const picked = params.get("run");
  const [q, setQ] = useState(params.get("q") ?? "");
  // The router's address, so a row opens in a story as it does in the app.
  const here = `/${useRoute().path.join("/")}`;
  // A read per pause in the search box, not per key.
  const asked = useSettled(q.trim());
  // One key per list: a replay re-reads it (`retry`), so an older answer never repaints it.
  const list = useCall(`executions:${w.id}:${view}:${asked}`, () =>
    call<RecordsPage>("console/recordsList", {
      record: "console.execution",
      view,
      where: { workflow: w.id },
      ...(asked ? { q: asked } : {}),
      limit: 50,
    }),
  );
  const rows = (list.data?.rows ?? []) as unknown as ExecutionRow[];
  const open = picked ?? rows[0]?.id ?? null;
  return (
    <div className="grid items-start gap-5 min-[1000px]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Which executions">
          {STATES.map((s) => (
            <a
              key={s.id}
              role="tab"
              aria-selected={view === s.id}
              href={href(here, { runs: s.id === "all" ? null : s.id, run: null }, params)}
              className={cx(
                "h-7 px-2.5 text-[13px] leading-7 no-underline",
                view === s.id
                  ? "bg-(--ui-ink) text-(--ui-paper)"
                  : "text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)",
              )}
            >
              {s.label}
              {list.data?.counts[s.id] !== undefined ? (
                <span className="ml-1 tabular-nums opacity-70">{list.data.counts[s.id]}</span>
              ) : null}
            </a>
          ))}
        </div>
        {/* edit-ok: search box */}
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find by name or subject"
          aria-label="Find by name or subject"
          className="h-8 text-[13px]"
        />
        {view === "failed" && rows.length && mayRetry(can) ? (
          <ReplayAll ids={rows.map((r) => r.id)} onDone={list.retry} />
        ) : null}
        {list.error && !list.data ? (
          <LoadFailed error={list.error} onRetry={list.retry} />
        ) : !list.data ? (
          <Loading shape="rows" lines={5} />
        ) : rows.length ? (
          <RowsPanel<ExecutionRow>
            rows={rows}
            rowKey={(r) => r.id}
            // The pane is 260 to 320px wide: the phone's shape, name and state, at any screen.
            narrow
            label="executions"
            noun="execution"
            open={{
              id: open,
              onOpen: (r) => navigate(href(here, { run: r.id }, params)),
            }}
            name={{
              label: "Execution",
              icon: "text",
              title: (r) => r.title,
              href: (r) => href(here, { run: r.id }, params),
              sub: (r) => (
                <span className={cx("grid gap-0.5 text-[12px]", QUIET)}>
                  <span
                    className="wrap-anywhere whitespace-normal"
                    {...tipProps(r.subject, { as: "none" })}
                  >
                    {r.state === "waiting" && r.due
                      ? `At ${nameAt(w, r.node)}${r.until ? "," : ""}${forText(r.until)} until ${when(r.due)}`
                      : r.state === "failed"
                        ? `Failed at ${nameAt(w, r.node)}`
                        : `Last at ${nameAt(w, r.node)}`}
                  </span>
                  <span
                    className="tabular-nums"
                    {...tipProps(
                      `Entered ${whenTip(new Date(r.entered), relative(new Date(r.entered)))}`,
                    )}
                  >
                    {age(r.entered)}
                  </span>
                </span>
              ),
            }}
            columns={[
              {
                key: "state",
                label: "State",
                icon: "selected",
                phone: true,
                cell: (r) => <StateMark state={STATE[r.state]} />,
              },
            ]}
          />
        ) : (
          <Empty>
            {q ? "Nothing matches that." : "Nothing has run through this workflow on the spine."}
          </Empty>
        )}
      </div>
      {open ? (
        <OneExecution key={open} id={open} w={w} can={can} onRetried={list.retry} />
      ) : (
        <p className={cx("text-[14px]", QUIET)}>Open one to see its path.</p>
      )}
    </div>
  );
}

/** Every failed run in the list, again at once. Each failed step behind them runs again. */
function ReplayAll({ ids, onDone }: { ids: readonly string[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const go = async () => {
    if (
      !confirm(`Run ${ids.length} failed run${ids.length === 1 ? "" : "s"} again? They may send.`)
    )
      return;
    setBusy(true);
    setSaid(null);
    try {
      const got = await call<{ replayed: number }>("console/replay", { ids });
      setSaid(`Replaying ${got.replayed} step${got.replayed === 1 ? "" : "s"}.`);
      onDone();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="dense" tone="secondary" busy={busy} onClick={() => void go()}>
        Replay all {ids.length}
      </Button>
      {said ? <span className={cx("text-[12.5px]", QUIET)}>{said}</span> : null}
    </div>
  );
}

/** A node path's name on this canvas: its card, then the step inside it. */
export function nameAt(w: Drawn, node: string): string {
  const [head = "", ...rest] = node.split(".");
  if (head === "out") return "the end";
  const card = w.nodes.find((n) => n.id === head)?.name ?? head;
  return rest.length ? `${card} › ${rest.join(" › ")}` : card;
}

/** One execution, read and lit on `w`. */
function OneExecution({
  id,
  w,
  can,
  onRetried,
}: {
  id: string;
  w: Drawn;
  can: readonly string[] | undefined;
  onRetried: () => void;
}) {
  const got = useCall(`execution:${id}`, () =>
    call<RecordAnswer>("console/recordsGet", { record: "console.execution", id }),
  );
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={6} />;
  const steps = (got.data.detail as { steps?: TraceStep[] } | null)?.steps ?? [];
  const row = got.data.row as unknown as ExecutionRow;
  return (
    <div className="grid min-w-0 gap-3">
      <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-[14px]">
        <span className="font-semibold" {...tipProps(row.subject, { as: "none" })}>
          {row.title}
        </span>
        <span className={QUIET}>
          Entered {when(row.entered)}, {row.steps} step{row.steps === 1 ? "" : "s"}
        </span>
      </p>
      <ExecutionTrace
        w={w}
        steps={steps}
        can={can}
        onRetried={() => {
          got.retry();
          onRetried();
        }}
      />
    </div>
  );
}

/** The path lit on the canvas, and the step a card click opens. */
export function ExecutionTrace({
  w,
  steps,
  can,
  onRetried,
}: {
  w: Drawn;
  steps: readonly TraceStep[];
  can: readonly string[] | undefined;
  onRetried: () => void;
}) {
  const t = useMemo(() => traceOf(w, steps), [w, steps]);
  const base = useMemo(() => graphOf(w, { counts: new Map(), where: NOWHERE, team: true }), [w]);
  const nodes = useMemo(() => litNodes(base.nodes, t, when), [base, t]);
  const failed = steps.find((s) => s.error);
  const [card, setCard] = useState<string | null>(
    failed ? cardOf(failed) : steps.length ? cardOf(steps.at(-1) as TraceStep) : null,
  );
  const shown = card ? (t.steps.get(card) ?? []) : [];
  return (
    <div className="grid min-w-0 gap-4">
      <Graph
        nodes={nodes}
        edges={base.edges}
        label={`This execution through ${w.name}`}
        name={`${w.id}-execution`}
        focus={t.lit}
        tools={false}
        onOpen={setCard}
      />
      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Steps in order">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setCard(cardOf(s))}
              className={cx(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 border border-(--ui-hair) bg-(--ui-paper) px-2 text-[12.5px] text-(--ui-ink) hover:bg-(--ui-hover)",
                card === cardOf(s) && "border-(--ui-active)",
                s.error && "text-(--ui-bad)",
              )}
            >
              <span className="tabular-nums text-(--ui-ink-3)">{i + 1}</span>
              {nameAt(w, s.node)}
            </button>
          </li>
        ))}
      </ol>
      {shown.length ? (
        <div className="grid gap-4">
          {shown.map((s) => (
            <StepData key={s.id} w={w} s={s} retry={mayRetry(can)} onRetried={onRetried} />
          ))}
        </div>
      ) : card ? (
        <p className={cx("m-0 text-[14px]", QUIET)}>
          {card.startsWith("in.") ? "It entered here." : "It never reached this card."}
        </p>
      ) : null}
    </div>
  );
}

/** One step: what came in, what its step sent on, and why it failed. */
function StepData({
  w,
  s,
  retry,
  onRetried,
}: {
  w: Drawn;
  s: TraceStep;
  retry: boolean;
  onRetried: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const again = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const got = await call<{ failed?: number }>("console/retryEvent", { id: s.id });
      setSaid(got.failed ? "It failed again." : "It ran again.");
      onRetried();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-2 border border-(--ui-hair) bg-(--ui-paper) p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[14px] font-semibold">{nameAt(w, s.node)}</h3>
        <span className={cx("text-[12.5px]", QUIET)}>
          In on {s.port} at {when(s.at)}
          {s.sentAt ? `, done ${when(s.sentAt)}` : ""}
        </span>
      </header>
      <div className="grid gap-3 min-[720px]:grid-cols-2">
        <div className="grid min-w-0 content-start gap-1">
          <span className={cx("text-[12px] font-medium", QUIET)}>In: {s.kind}</span>
          <pre className={PRE}>{dataText(s.data)}</pre>
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <span className={cx("text-[12px] font-medium", QUIET)}>Out</span>
          {s.error ? (
            <p className="m-0 text-[13px] text-(--ui-bad)" {...tipProps(s.error)}>
              It failed here: {wordsOf("reason", s.error)}
            </p>
          ) : s.due ? (
            <p className="m-0 text-[13px]">
              Waits here{forText(s.until)} until {when(s.due)}.
            </p>
          ) : s.sent === null ? (
            <p className={cx("m-0 text-[13px]", QUIET)}>Not kept for this step.</p>
          ) : s.sent.length === 0 ? (
            <p className={cx("m-0 text-[13px]", QUIET)}>Nothing sent on. Its own code moves it.</p>
          ) : (
            s.sent.map((o) => (
              <div key={`${o.port}:${o.subject}`} className="grid gap-1">
                <span className="text-[12px]">
                  On {o.port}: {o.kind}
                </span>
                <pre className={PRE}>{dataText(o.data)}</pre>
              </div>
            ))
          )}
        </div>
      </div>
      {s.error && retry ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="dense" busy={busy} onClick={() => void again()}>
            Retry
          </Button>
          <span className={cx("text-[12.5px]", QUIET)}>
            {said ?? "Runs this step again. It may send."}
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** An execution's page from the list (⌘K, a lead's journey): its workflow lit. */
export const executionExtras: NonNullable<ListPage["extras"]> = (detail, { row, can }) => ({
  sections: [
    [
      "Path",
      <ExecutionOnList
        key="path"
        workflow={String(row.workflow ?? "")}
        steps={(detail as { steps?: TraceStep[] } | null)?.steps ?? []}
        can={can}
      />,
    ],
  ],
});

function ExecutionOnList({
  workflow,
  steps,
  can,
}: {
  workflow: string;
  steps: readonly TraceStep[];
  can: readonly string[] | undefined;
}) {
  const w = useDrawn(workflow, null);
  if (w.error && !w.data) return <LoadFailed error={w.error} onRetry={w.retry} />;
  if (!w.data) return <Loading lines={4} />;
  const drawn = w.data;
  return (
    <div className="grid gap-3">
      <ExecutionTrace w={drawn} steps={steps} can={can} onRetried={() => undefined} />
      <a
        className="text-[13px]"
        href={href("/workflows/canvas", { path: workflow, pane: "runs" })}
        onClick={(e) => {
          e.preventDefault();
          navigate(href("/workflows/canvas", { path: workflow, pane: "runs" }));
        }}
      >
        All executions of {drawn.name}
      </a>
    </div>
  );
}
