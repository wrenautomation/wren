/**
 * A sequence's page in the Library: its steps drawn on the graph kit (the canvas the workflow
 * editor draws on, read-only here), then a row per step with its template, live version,
 * variants and numbers. A step opens its template.
 */
import { DataTable, Graph, type RecordExtras, type TableColumn } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { CHANNEL, picksText, replyRate, type SeqStep, sequenceGraph } from "./sequence.js";

const templateHref = (s: SeqStep) =>
  s.templateId ? `/library/templates/${encodeURIComponent(s.templateId)}` : undefined;

function Steps({ steps }: { steps: readonly SeqStep[] }) {
  const columns: TableColumn<SeqStep>[] = [
    {
      key: "step",
      label: "Step",
      cell: (s) => (
        <>
          {s.step}
          <div className={`text-[12.5px] ${QUIET}`}>
            {s.wait ? `after ${s.wait}` : "right away"}
          </div>
        </>
      ),
    },
    {
      key: "template",
      label: "Template",
      cell: (s) => {
        const to = templateHref(s);
        return (
          <>
            {to ? <a href={to}>{s.template}</a> : s.template}
            <div className={`text-[12.5px] ${QUIET}`}>
              {CHANNEL[s.kind] ?? s.kind}, {s.system}
              {s.liveVersion ? (
                <>
                  , live <span className="tabular-nums">v{s.liveVersion}</span>
                </>
              ) : (
                ", nothing live"
              )}
            </div>
          </>
        );
      },
    },
    {
      key: "variants",
      label: "Variants",
      cell: (s) =>
        s.variants.length ? (
          <ul className="grid gap-0.5">
            {s.variants.map((v) => (
              <li key={JSON.stringify(v.picks)}>
                {picksText(v.picks)}{" "}
                <span className={QUIET}>
                  · {v.sends} sent{v.sends ? `, ${replyRate(v.replies, v.sends)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className={QUIET}>Not sent on the live version</span>
        ),
    },
    { key: "sent", label: "Sent", end: true, cell: (s) => s.sends.toLocaleString() },
    {
      key: "replied",
      label: "Replied",
      end: true,
      cell: (s) => (
        <>
          {s.sends ? `${s.replies} · ${replyRate(s.replies, s.sends)}` : "—"}
          {s.booked ? <div className={QUIET}>{s.booked} booked</div> : null}
        </>
      ),
    },
  ];
  return <DataTable columns={columns} data={steps} rowKey={(s) => s.node} />;
}

export const sequenceExtras: NonNullable<ListPage["extras"]> = (detail, { row }) => {
  const steps = (detail as { steps?: SeqStep[] } | null)?.steps ?? [];
  if (!steps.length) return {};
  const g = sequenceGraph(steps, templateHref);
  const name = String(row.name ?? row.id);
  return {
    sections: [
      [
        "Drawing",
        <div key="drawing" className="grid gap-2">
          <Graph {...g} label={`The steps of ${name}`} name={String(row.id)} maxHeight={460} />
          <a
            className={`text-[13px] ${QUIET}`}
            href={`/workflows/canvas?path=${encodeURIComponent(String(row.id))}`}
          >
            Open it in Workflows
          </a>
        </div>,
      ],
      ["Steps", <Steps key="steps" steps={steps} />],
    ],
  } satisfies RecordExtras;
};
