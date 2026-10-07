/**
 * A sequence's page in the Library: its steps drawn on the graph kit (the canvas the workflow
 * editor draws on, read-only here), then a row per step with its template, live version,
 * variants and numbers. A step opens its template.
 */
import { Graph, type RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { CHANNEL, picksText, replyRate, type SeqStep, sequenceGraph } from "./sequence.js";

const templateHref = (s: SeqStep) =>
  s.templateId ? `/library/templates/${encodeURIComponent(s.templateId)}` : undefined;

function Steps({ steps }: { steps: readonly SeqStep[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13.5px]">
        <thead className={QUIET}>
          <tr className="border-b border-(--ui-hair)">
            <th className="py-1.5 pr-3 font-normal">Step</th>
            <th className="py-1.5 pr-3 font-normal">Template</th>
            <th className="py-1.5 pr-3 font-normal">Variants</th>
            <th className="py-1.5 pr-3 text-right font-normal">Sent</th>
            <th className="py-1.5 text-right font-normal">Replied</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => {
            const to = templateHref(s);
            return (
              <tr key={s.node} className="border-b border-(--ui-hair) align-top">
                <td className="py-1.5 pr-3">
                  {s.step}
                  <div className={`text-[12.5px] ${QUIET}`}>
                    {s.wait ? `after ${s.wait}` : "right away"}
                  </div>
                </td>
                <td className="py-1.5 pr-3">
                  {to ? <a href={to}>{s.template}</a> : s.template}
                  <div className={`text-[12.5px] ${QUIET}`}>
                    {CHANNEL[s.kind] ?? s.kind}, {s.system}
                    {s.liveVersion ? (
                      <>
                        , live <span className="font-mono">{s.liveVersion.slice(0, 8)}</span>
                      </>
                    ) : (
                      ", nothing live"
                    )}
                  </div>
                </td>
                <td className="py-1.5 pr-3">
                  {s.variants.length ? (
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
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{s.sends.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {s.sends ? `${s.replies} · ${replyRate(s.replies, s.sends)}` : "—"}
                  {s.booked ? <div className={QUIET}>{s.booked} booked</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
