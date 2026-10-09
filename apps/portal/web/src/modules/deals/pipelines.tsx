/**
 * Opportunities → Pipelines: each pipeline's name and stages, in order, edited as one form. A
 * stage's key stays as its label changes, so workflows that name it keep working. The server
 * refuses dropping a stage that still holds deals.
 */
import type { Board } from "@wren/deals/console";
import type { Stage, StageKind } from "@wren/deals/schema";
import { Button, Input, LoadFailed, Loading, PageHeader, Section, say } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { atOf } from "./board.js";

type Pipe = Board["pipelines"][number];
type Line = Stage & { line: number };
let lines = 0;
const lineOf = (s: Stage): Line => ({ ...s, line: ++lines });

const SELECT =
  "min-h-[38px] border border-(--ui-hair) bg-(--ui-paper) px-2 py-1 text-[14px] text-(--ui-ink) focus:border-(--ui-accent) focus:outline-none";
const KIND_LABELS: Record<StageKind, string> = { open: "Open", won: "Won", lost: "Lost" };

const FRESH: Pipe = {
  id: "",
  name: "",
  stages: [
    { key: "", label: "New", kind: "open" },
    { key: "", label: "Won", kind: "won" },
    { key: "", label: "Lost", kind: "lost" },
  ],
};

export function Pipelines(props: PageProps) {
  const at = atOf(props.client);
  const got = useCall(`deals-pipelines:${props.client}`, () => call<Board>("deals/board", at));
  const [adding, setAdding] = useState(false);
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={4} />;
  const write = !props.demo;
  const many = got.data.pipelines.length > 1;
  return (
    <>
      <PageHeader
        title="Pipelines"
        lede="Each pipeline's stages, in board order. Every pipeline has one won and one lost stage."
        actions={
          write && !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              New pipeline
            </Button>
          ) : null
        }
      />
      {adding ? (
        <Section title="New pipeline">
          <PipeForm
            at={at}
            pipe={FRESH}
            write
            onDone={() => {
              setAdding(false);
              got.retry();
            }}
          />
        </Section>
      ) : null}
      {got.data.pipelines.map((p) => (
        <Section key={p.id} title={p.name}>
          <PipeForm at={at} pipe={p} write={write} drop={many} onDone={got.retry} />
        </Section>
      ))}
    </>
  );
}

function PipeForm({
  at,
  pipe,
  write,
  drop,
  onDone,
}: {
  at: Record<string, string>;
  pipe: Pipe;
  write: boolean;
  drop?: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(pipe.name);
  // Each line keeps its own id while its label and place change.
  const [stages, setStages] = useState<Line[]>(() => pipe.stages.map(lineOf));
  const [busy, setBusy] = useState(false);
  const put = (i: number, s: Partial<Line>) =>
    setStages((all) => all.map((x, j) => (j === i ? { ...x, ...s } : x)));
  const shift = (i: number, by: -1 | 1) =>
    setStages((all) => {
      const next = [...all];
      const [s] = next.splice(i, 1);
      if (s) next.splice(i + by, 0, s);
      return next;
    });
  const run = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await call(path, { ...at, ...body });
      say.done(done);
      onDone();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <label className="grid max-w-[360px] gap-1 text-[13px] font-medium text-(--ui-ink-2)">
        Name
        <Input value={name} disabled={!write} onChange={(e) => setName(e.target.value)} />
      </label>
      <ol className="m-0 grid list-none gap-2 p-0">
        {stages.map((s, i) => (
          <li key={s.line} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-[12.5px] text-(--ui-ink-3)">{i + 1}</span>
            <Input
              aria-label={`Stage ${i + 1}`}
              className="w-[200px]"
              value={s.label}
              disabled={!write}
              onChange={(e) => put(i, { label: e.target.value })}
            />
            <select
              aria-label={`Stage ${i + 1} kind`}
              className={SELECT}
              value={s.kind}
              disabled={!write}
              onChange={(e) => put(i, { kind: e.target.value as StageKind })}
            >
              {(Object.keys(KIND_LABELS) as StageKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            {write ? (
              <>
                <Button size="sm" tone="quiet" disabled={i === 0} onClick={() => shift(i, -1)}>
                  Up
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  disabled={i === stages.length - 1}
                  onClick={() => shift(i, 1)}
                >
                  Down
                </Button>
                <Button
                  size="sm"
                  tone="quiet"
                  onClick={() => setStages((all) => all.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </>
            ) : null}
            {s.key ? <span className="text-[12px] text-(--ui-ink-3)">{s.key}</span> : null}
          </li>
        ))}
      </ol>
      {write ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            tone="quiet"
            onClick={() =>
              setStages((all) => [...all, lineOf({ key: "", label: "", kind: "open" })])
            }
          >
            Add a stage
          </Button>
          <Button
            size="sm"
            busy={busy}
            onClick={() =>
              run(
                "deals/pipelineSave",
                {
                  ...(pipe.id ? { id: pipe.id } : {}),
                  name,
                  stages: stages.map((s) => ({
                    ...(s.key ? { key: s.key } : {}),
                    label: s.label,
                    kind: s.kind,
                  })),
                },
                "Saved.",
              )
            }
          >
            Save
          </Button>
          {pipe.id && drop ? (
            <Button
              size="sm"
              tone="quiet"
              busy={busy}
              onClick={() => run("deals/pipelineDrop", { id: pipe.id }, "Deleted.")}
            >
              Delete pipeline
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
