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
  EditConflict,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  Section,
  say,
  UnsavedMark,
  useEdit,
} from "@wren/ui";
import { useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { useEditJson } from "../people/edit-json.js";
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
  const at = `pipeline:${pipe.id || "new"}`;
  const version = pipe.version || null;
  const nameEdit = useEdit(`${at}:name`, pipe.name, { version });
  const stagesEdit = useEditJson<Stage[]>(`${at}:stages`, pipe.stages, {
    version,
    show: (all) => all.map((s) => s.label || "(no name)").join(", "),
  });
  const name = nameEdit.value;
  const stages = stagesEdit.value;
  const setStages = stagesEdit.set;
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
    if (flying.current) return;
    flying.current = true;
    setBusy(true);
    try {
      await ACTIONS.run(`${path}:${pipe.id || "new"}`, (requestId) =>
        call(path, { ...where, ...body, requestId }),
      );
      // Saved or deleted: the typed words are done with.
      nameEdit.saved();
      stagesEdit.saved();
      say.done(done);
      onDone();
    } catch (err) {
      say.failed(err);
    } finally {
      flying.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <label className="grid max-w-[360px] gap-1 text-[13px] font-medium text-(--ui-ink-2)">
        Name
        <Input {...nameEdit.field} disabled={!write} />
      </label>
      <EditConflict
        conflict={nameEdit.conflict}
        onKeepMine={nameEdit.keepMine}
        onTakeTheirs={nameEdit.takeTheirs}
        what="The name"
      />
      <ol className="m-0 grid list-none gap-2 p-0">
        {stages.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stages are plain values; place is their id.
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-right text-[12.5px] text-(--ui-ink-3)">{i + 1}</span>
            <Input
              aria-label={`Stage ${i + 1}`}
              className="w-[200px]"
              data-edit={stagesEdit.key}
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
      <EditConflict
        conflict={stagesEdit.conflict}
        onKeepMine={stagesEdit.keepMine}
        onTakeTheirs={stagesEdit.takeTheirs}
        what="The stages"
      />
      {write ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            tone="quiet"
            onClick={() => setStages([...stages, { key: "", label: "", kind: "open" }])}
          >
            Add a stage
          </Button>
          <Button
            tone="primary"
            size="sm"
            busy={busy}
            onClick={() =>
              run(
                "deals/pipelineSave",
                {
                  ...(pipe.id ? { id: pipe.id, expect: pipe.version } : {}),
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
          <UnsavedMark edit={{ dirty: nameEdit.dirty || stagesEdit.dirty, conflict: null }} />
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
