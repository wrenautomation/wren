/**
 * Opportunities → Pipelines: each pipeline's name and stages, in order, edited as one form. A
 * stage's key stays as its label changes, so workflows that name it keep working. The server
 * refuses dropping a stage that still holds deals.
 */
import type { Board } from "@wren/deals/console";
import type { Stage, StageKind } from "@wren/deals/schema";
import {
  ACTIONS,
  Button,
  FormKept,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  say,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { atOf } from "./board.js";

type Pipe = Board["pipelines"][number];

const SELECT =
  "min-h-[38px] border border-(--ui-hair) bg-(--ui-paper) px-2 py-1 text-[14px] text-(--ui-ink) focus:border-(--ui-focus) focus:outline-none";
const KIND_LABELS: Record<StageKind, string> = { open: "Open", won: "Won", lost: "Lost" };

const FRESH: Pipe = {
  id: "",
  name: "",
  version: "",
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
            <Button tone="primary" size="sm" onClick={() => setAdding(true)}>
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
  at: where,
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
  // The name and the stages are kept as typed until saved, on this device.
  const form = useEditForm({
    key: `pipeline:${pipe.id || "new"}`,
    defaults: { name: pipe.name, stages: pipe.stages },
    base: pipe.version || undefined,
  });
  const stages: Stage[] = form.watch("stages");
  const setStages = (next: Stage[]) => form.setValue("stages", next);
  const [busy, setBusy] = useState(false);
  const put = (i: number, s: Partial<Stage>) =>
    setStages(stages.map((x, j) => (j === i ? { ...x, ...s } : x)));
  const shift = (i: number, by: -1 | 1) => {
    const next = [...stages];
    const [s] = next.splice(i, 1);
    if (s) next.splice(i + by, 0, s);
    setStages(next);
  };
  // One action at a time; a retry after a lost answer is the same action (its request id).
  const flying = useRef(false);
  const run = async (path: string, body: Record<string, unknown>, done: string) => {
    if (flying.current) return false;
    flying.current = true;
    setBusy(true);
    try {
      await ACTIONS.run(`${path}:${pipe.id || "new"}`, (requestId) =>
        call(path, { ...where, ...body, requestId }),
      );
      say.done(done);
      onDone();
      return true;
    } catch (err) {
      say.failed(err);
      return false;
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  const save = form.onSend((v) =>
    run(
      "deals/pipelineSave",
      {
        ...(pipe.id ? { id: pipe.id, expect: pipe.version } : {}),
        name: v.name,
        stages: v.stages.map((s) => ({
          ...(s.key ? { key: s.key } : {}),
          label: s.label,
          kind: s.kind,
        })),
      },
      "Saved.",
    ),
  );
  const remove = async () => {
    // Deleted: the typed words are done with.
    if (await run("deals/pipelineDrop", { id: pipe.id }, "Deleted.")) form.forget();
  };
  return (
    <div className="grid gap-3">
      <TextField
        form={form}
        name="name"
        label="Name"
        className="grid max-w-[360px] gap-1 font-medium"
        disabled={!write}
      />
      <ol className="m-0 grid list-none gap-2 p-0">
        {stages.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stages are plain values; place is their id.
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-[12.5px] text-(--ui-ink-3)">{i + 1}</span>
            <Input
              aria-label={`Stage ${i + 1}`}
              className="w-[200px]"
              data-edit="form:stages"
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
                  onClick={() => setStages(stages.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </>
            ) : null}
            {s.key ? <span className="text-[12px] text-(--ui-ink-3)">{s.key}</span> : null}
          </li>
        ))}
      </ol>
      <FormKept form={form} />
      {write ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            tone="quiet"
            onClick={() => setStages([...stages, { key: "", label: "", kind: "open" }])}
          >
            Add a stage
          </Button>
          <Button tone="primary" size="sm" busy={busy} onClick={() => void save()}>
            Save
          </Button>
          {pipe.id && drop ? (
            <Button size="sm" tone="quiet" busy={busy} onClick={() => void remove()}>
              Delete pipeline
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
