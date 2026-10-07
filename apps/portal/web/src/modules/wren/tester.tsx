/**
 * Test step and Test workflow (designs/2026-10-06-workflow-editor.md, Test): the draft as it is
 * on the canvas, walked dry on the server. Logic runs for real, rules answer as he picks, and a
 * step that sends, spends or posts says what it would do and does nothing. Nothing is claimed.
 */
import type { Port } from "@wren/core/components";
import { DOOR_TRIGGERS } from "@wren/core/logic";
import { Button, cx, Tag, Textarea } from "@wren/ui";
import { useId, useMemo, useState } from "react";
import { call } from "../../api.js";
import type { Drawn } from "../marketplace/boxes.js";
import { FIELD, QUIET, SELECT } from "../work/bits.js";
import { afterText, type DryResult, type DryStep, entriesOf } from "./dry.js";
import { Block, PANEL, PanelHead, PRE, RIGHT, useLast } from "./editor.js";
import { nameAt } from "./executions.js";
import { dataText } from "./trace.js";
import type { Draft } from "./wiring.js";

/** A made-up event of `kind` to start from: about no one real. */
export const SAMPLE: Record<string, Record<string, unknown>> = {
  lead: { name: "Sam Test", email: "sam@example.com", phone: "+15555550100" },
};
/** A made-up form post for a door: a lead who ticked the text box. */
export const SAMPLE_POST = {
  name: "Sam Test",
  email: "sam@example.com",
  phone: "+15555550100",
  sms_consent: "yes",
  source: "test",
};
const sampleText = (kind: string | undefined) => JSON.stringify(SAMPLE[kind ?? ""] ?? {}, null, 2);

type Run = { state: "idle" } | { state: "busy" } | { state: "failed"; error: string } | DryDone;
type DryDone = {
  state: "done";
  entered?: { subject: string; data: Record<string, unknown> };
} & DryResult;

/** What he tests with: an input, its data as JSON, and what every rule answers. */
function useTestForm(ports: readonly Port[]) {
  const [port, setPort] = useState(ports[0]?.id ?? "");
  const [text, setText] = useState(sampleText(ports[0]?.kind));
  const [rules, setRules] = useState(true);
  const kind = ports.find((p) => p.id === port)?.kind;
  const parsed = (() => {
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();
  return { port, setPort, text, setText, rules, setRules, kind, parsed };
}

function TestFields({
  ports,
  f,
  label,
}: {
  ports: readonly Port[];
  f: ReturnType<typeof useTestForm>;
  label: string;
}) {
  const base = useId();
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      <label htmlFor={`${base}-port`} className={cx(FIELD, "min-w-0")}>
        <span>{label}</span>
        <select
          id={`${base}-port`}
          className={cx(SELECT, "w-full min-w-0")}
          value={f.port}
          onChange={(e) => {
            f.setPort(e.target.value);
            f.setText(sampleText(ports.find((p) => p.id === e.target.value)?.kind));
          }}
        >
          {ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.kind})
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${base}-data`} className={cx(FIELD, "min-w-0")}>
        <span>Its data</span>
        <Textarea
          id={`${base}-data`}
          className="min-h-[96px] w-full min-w-0 font-mono text-[12px]"
          value={f.text}
          spellCheck={false}
          onChange={(e) => f.setText(e.target.value)}
        />
        {f.parsed ? null : <span className="text-(--ui-bad)">That isn't a JSON object.</span>}
      </label>
      <label htmlFor={`${base}-rules`} className={cx(FIELD, "min-w-0")}>
        <span>Every rule answers</span>
        <select
          id={`${base}-rules`}
          className={cx(SELECT, "w-full min-w-0")}
          value={f.rules ? "yes" : "no"}
          onChange={(e) => f.setRules(e.target.value === "yes")}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
    </div>
  );
}

/** An output's label on a card of this canvas; its id deeper in. */
const outLabel = (w: Drawn, node: string, port: string) =>
  w.nodes.find((n) => n.id === node)?.out?.find((p) => p.id === port)?.label ?? port;

/** One step of a test: where, when on the test's clock, what it would do, and its data. */
function DryRow({ w, s, i }: { w: Drawn; s: DryStep; i: number }) {
  return (
    <li className="grid gap-1.5 border-t border-(--ui-hair) pt-2">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular-nums text-(--ui-ink-3)">{i + 1}</span>
        <span className="font-medium">{nameAt(w, s.node)}</span>
        <span className={cx("text-[12px]", QUIET)}>{afterText(s.at)}</span>
        {s.would ? <Tag tone="accent">{s.would}</Tag> : null}
      </span>
      {s.error ? <span className="text-[13px] text-(--ui-bad)">It failed: {s.error}</span> : null}
      <span className={cx("text-[12.5px]", QUIET)}>
        {s.out.length
          ? `Sent on by ${s.out.map((o) => outLabel(w, s.node, o.port)).join(", ")}.`
          : s.error
            ? ""
            : s.waited
              ? `Waited ${afterText(s.waited).replace("after ", "")} on its wire, then went in.`
              : "Nothing sent on."}
      </span>
      <details>
        <summary className={cx("cursor-pointer text-[12.5px]", QUIET)}>Data</summary>
        <div className="mt-1.5 grid gap-1.5">
          <span className={cx("text-[12px]", QUIET)}>In on {s.port}</span>
          <pre className={PRE}>{dataText(s.in, 2000)}</pre>
          {s.out.map((o) => (
            <div key={o.port} className="grid gap-1">
              <span className={cx("text-[12px]", QUIET)}>Out on {o.port}</span>
              <pre className={PRE}>{dataText(o.data, 2000)}</pre>
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}

function DryOut({ w, run }: { w: Drawn; run: Run }) {
  if (run.state === "idle") return null;
  if (run.state === "busy") return <p className={QUIET}>Testing…</p>;
  if (run.state === "failed") return <p className="text-(--ui-bad)">{run.error}</p>;
  const t = run.tally;
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[13px]">
        {run.steps.length} step{run.steps.length === 1 ? "" : "s"}, {t.out} out
        {t.failed ? `, ${t.failed} failed` : ""}. Nothing was sent.
      </p>
      {run.capped ? (
        <p className="m-0 text-[13px] text-(--warn)">
          It stopped early: a loop, or too many steps.
        </p>
      ) : null}
      <ol className="m-0 grid list-none gap-2 p-0">
        {run.steps.map((s, i) => (
          <DryRow key={`${s.node}:${s.port}:${s.subject}`} w={w} s={s} i={i} />
        ))}
      </ol>
    </div>
  );
}

const body = (workflow: string, client: string | null, draft: Draft) => ({
  workflow,
  ...(client ? { client } : {}),
  wires: draft.wires,
  steps: draft.steps,
});

const failedOf = (err: unknown): Run => ({
  state: "failed",
  error: err instanceof Error ? err.message : String(err),
});

/** A real arrival's data, pinned into the test: the team's own spine only. */
function LastInput({
  workflow,
  node,
  use,
}: {
  workflow: string;
  node: string;
  use: (text: string) => void;
}) {
  const last = useLast(workflow, node);
  if (!last.data) return null;
  const data = last.data.data;
  return (
    <Button tone="quiet" size="dense" onClick={() => use(JSON.stringify(data, null, 2))}>
      Use its last real input
    </Button>
  );
}

/** Test step, in the node panel: this node alone on one event, dry. */
export function TestStep({
  w,
  workflow,
  client,
  draft,
  node,
}: {
  w: Drawn;
  workflow: string;
  client: string | null;
  draft: Draft;
  node: string;
}) {
  const n = w.nodes.find((x) => x.id === node);
  const ports = n?.in ?? [];
  const f = useTestForm(ports);
  const [run, setRun] = useState<Run>({ state: "idle" });
  // A trigger takes nothing in: its test is the workflow from its output, as if it fired.
  if (!ports.length && n?.out?.[0])
    return (
      <TestTrigger
        w={w}
        workflow={workflow}
        client={client}
        draft={draft}
        node={node}
        out={n.out[0]}
        door={DOOR_TRIGGERS.has(n.uses ?? "")}
      />
    );
  if (!ports.length)
    return <p className={QUIET}>It takes nothing in, so there's nothing to test.</p>;
  const go = async () => {
    if (!f.parsed) return;
    setRun({ state: "busy" });
    try {
      const got = await call<DryResult>("console/workflowTest", {
        ...body(workflow, client, draft),
        node,
        port: f.port,
        kind: f.kind,
        data: f.parsed,
        rules: f.rules,
      });
      setRun({ state: "done", ...got });
    } catch (err) {
      setRun(failedOf(err));
    }
  };
  return (
    <div className="grid gap-3">
      <TestFields ports={ports} f={f} label="On input" />
      <span className="flex flex-wrap items-center gap-2">
        <Button size="dense" onClick={go} disabled={!f.parsed} busy={run.state === "busy"}>
          Test step
        </Button>
        {client ? null : <LastInput workflow={workflow} node={node} use={(t) => f.setText(t)} />}
      </span>
      <DryOut w={w} run={run} />
    </div>
  );
}

type Lead = Partial<
  Record<"name" | "phone" | "email" | "source" | "zone" | "niche", string | null>
> & {
  consent?: boolean;
};

/** What the door read from the post, by the node's field map. */
function ReadAs({ lead }: { lead: Lead | undefined }) {
  if (!lead) return null;
  const rows: [string, string][] = [
    ["Name", lead.name ?? ""],
    ["Phone", lead.phone ?? ""],
    ["Email", lead.email ?? ""],
    ["Text consent", lead.consent ? "Yes" : "No"],
    ["Source", lead.source ?? ""],
    ["Time zone", lead.zone ?? ""],
    ["Market", lead.niche ?? ""],
  ];
  return (
    <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-(--ui-ink-2)">{k}</dt>
          <dd className={cx("m-0 min-w-0 break-words", v ? "" : QUIET)}>{v || "Not found"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A trigger's test, in its panel: the workflow from its output, dry. A door's is "Send a test
 * lead": a made-up post read by its field map, then walked; nothing is sent.
 */
function TestTrigger({
  w,
  workflow,
  client,
  draft,
  node,
  out,
  door,
}: {
  w: Drawn;
  workflow: string;
  client: string | null;
  draft: Draft;
  node: string;
  out: Port;
  door: boolean;
}) {
  const base = useId();
  const [text, setText] = useState(
    JSON.stringify(door ? SAMPLE_POST : (SAMPLE[out.kind] ?? {}), null, 2),
  );
  const [run, setRun] = useState<Run>({ state: "idle" });
  const parsed = (() => {
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  })();
  const go = async () => {
    if (!parsed) return;
    setRun({ state: "busy" });
    try {
      const got = await call<Omit<DryDone, "state">>("console/workflowTest", {
        ...body(workflow, client, draft),
        from: `${node}.${out.id}`,
        data: parsed,
      });
      setRun({ state: "done", ...got });
    } catch (err) {
      setRun(failedOf(err));
    }
  };
  const lead = run.state === "done" ? (run.entered?.data.lead as Lead | undefined) : undefined;
  return (
    <div className="grid gap-3">
      <label htmlFor={`${base}-post`} className={cx(FIELD, "min-w-0")}>
        <span>{door ? "What the form posts" : "Its data"}</span>
        <Textarea
          id={`${base}-post`}
          className="min-h-[120px] w-full min-w-0 font-mono text-[12px]"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
        {parsed ? null : <span className="text-(--ui-bad)">That isn't a JSON object.</span>}
      </label>
      <span>
        <Button size="dense" onClick={go} disabled={!parsed} busy={run.state === "busy"}>
          {door ? "Send a test lead" : "Test from here"}
        </Button>
      </span>
      {door && lead ? (
        <div className="grid gap-1.5">
          <span className={cx("text-[12px]", QUIET)}>Read as</span>
          <ReadAs lead={lead} />
        </div>
      ) : null}
      <DryOut w={w} run={run} />
    </div>
  );
}

/** Test workflow: the whole draft from one of its inputs, dry; the canvas lights its path. */
export function TestPanel({
  w,
  workflow,
  client,
  draft,
  onResult,
  onClose,
}: {
  w: Drawn;
  workflow: string;
  client: string | null;
  draft: Draft;
  onResult: (r: { steps: readonly DryStep[]; from: string } | null) => void;
  onClose: () => void;
}) {
  const entries = useMemo(() => entriesOf(w), [w]);
  const f = useTestForm(entries);
  const [run, setRun] = useState<Run>({ state: "idle" });
  const go = async () => {
    if (!f.parsed) return;
    setRun({ state: "busy" });
    onResult(null);
    try {
      const got = await call<DryResult>("console/workflowTest", {
        ...body(workflow, client, draft),
        from: f.port,
        data: f.parsed,
        rules: f.rules,
      });
      setRun({ state: "done", ...got });
      onResult({ steps: got.steps, from: f.port });
    } catch (err) {
      setRun(failedOf(err));
    }
  };
  return (
    <aside aria-label="Test workflow" className={cx(PANEL, RIGHT)}>
      <PanelHead title="Test workflow" kind="Dry: nothing is sent" onClose={onClose} />
      {entries.length ? (
        <Block title="Event">
          <TestFields ports={entries} f={f} label="Enters at" />
          <span>
            <Button size="dense" onClick={go} disabled={!f.parsed} busy={run.state === "busy"}>
              Run test
            </Button>
          </span>
        </Block>
      ) : (
        <p className={QUIET}>Nothing can enter it: no inputs and no triggers.</p>
      )}
      {run.state === "idle" ? (
        <p className={QUIET}>Waits pass at once. Steps that send say what they would do.</p>
      ) : (
        <Block title="Result">
          <DryOut w={w} run={run} />
        </Block>
      )}
    </aside>
  );
}
