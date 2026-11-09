/**
 * A draft's versions (designs/2026-10-07-training-record.md, View): each one with who wrote it and
 * when, what was decided, and the kit's `Diff` between any two. From the detail's `record`
 * (`draftRecordOf`); the Activity tab holds the whole timeline.
 */
import type { DraftRecordView, DraftVersion } from "@wren/core/draft-record";
import { REJECT_LABELS, type RejectReason } from "@wren/core/reject-reasons";
import { Diff, exact } from "@wren/ui";
import { useState } from "react";
import { QUIET } from "../work/bits.js";

const when = (at: string) => exact(new Date(at));

function whoWrote(v: DraftVersion): string {
  if (v.via === "model") return `Drafted by ${v.by ?? "the model"}`;
  if (v.via === "claude") return `Claude, asked by ${v.by ?? "you"}`;
  if (v.via === "wren") return "From Wren";
  if (v.event === "sent") return "As sent";
  return `Edited by ${v.by ?? "you"}`;
}

const DID: Record<string, string> = {
  approved: "Approved",
  scheduled: "Scheduled",
  rejected: "Rejected",
  sent: "Sent",
  failed: "Failed",
};

function decisionLine(d: DraftRecordView["decisions"][number]): string {
  const why = [d.reason ? REJECT_LABELS[d.reason as RejectReason] : null, d.note]
    .filter(Boolean)
    .join(": ");
  return [
    DID[d.event] ?? d.event,
    d.by ? `by ${d.by}` : null,
    d.slot && d.event === "approved" ? `for ${when(d.slot)}` : null,
    why || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const pickClass =
  "h-8 min-w-0 border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink)";

export function DraftVersions({ record }: { record: DraftRecordView }) {
  const vs = record.versions;
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(vs.length);
  const a = vs[from - 1];
  const b = vs[to - 1];
  const label = (v: DraftVersion) => `Version ${v.n}`;
  return (
    <div className="grid min-w-0 gap-3 text-[13.5px]">
      {record.rounds > 1 ? (
        <p className={QUIET}>
          Draft {record.round} of {record.rounds} for this contact.
        </p>
      ) : null}
      <ol className="grid gap-1.5">
        {vs.map((v) => (
          <li key={v.n} className="min-w-0">
            <span className="font-medium tabular-nums">{label(v)}</span>{" "}
            <span className={QUIET}>
              · {whoWrote(v)} · {when(v.at)}
            </span>
            {v.ask ? <span className="block">“{v.ask}”</span> : null}
          </li>
        ))}
        {record.decisions.map((d) => (
          <li key={`${d.event}-${d.at}`} className={QUIET}>
            {decisionLine(d)} · {when(d.at)}
          </li>
        ))}
      </ol>
      {vs.length > 1 && a && b ? (
        <section className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span>Compare</span>
            <select
              aria-label="Older version"
              className={pickClass}
              value={from}
              onChange={(e) => setFrom(Number(e.target.value))}
            >
              {vs.map((v) => (
                <option key={v.n} value={v.n}>
                  {label(v)}
                </option>
              ))}
            </select>
            <span>with</span>
            <select
              aria-label="Newer version"
              className={pickClass}
              value={to}
              onChange={(e) => setTo(Number(e.target.value))}
            >
              {vs.map((v) => (
                <option key={v.n} value={v.n}>
                  {label(v)}
                </option>
              ))}
            </select>
          </div>
          <Diff
            a={[a.title, a.text].filter(Boolean).join("\n\n")}
            b={[b.title, b.text].filter(Boolean).join("\n\n")}
            names={[label(a), label(b)]}
          />
        </section>
      ) : null}
    </div>
  );
}
