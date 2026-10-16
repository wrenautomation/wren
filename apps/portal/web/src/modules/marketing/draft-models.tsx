/**
 * Marketing → Engage: which model writes reach drafts, and how each one's drafts fared
 * (designs/2026-10-14-draft-models.md). Shut by default; it reads when opened. The table is
 * `ReachDesk.draftModels`; the arms are set with `wren drafts models set`.
 */
import type { Scorecard } from "@wren/core/draft-models";
import { cx, DataTable, type TableColumn } from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { ERROR, QUIET } from "../work/bits.js";

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

type ModelRow = Scorecard["rows"][number];

const COLUMNS: TableColumn<ModelRow>[] = [
  {
    key: "model",
    label: "Model",
    cell: (r) => (
      <span className={r.armed ? "font-medium" : QUIET} title={r.by}>
        {r.label}
      </span>
    ),
  },
  { key: "drafts", label: "Drafts", cell: (r) => r.generated },
  {
    key: "unedited",
    label: "Unedited",
    cell: (r) => `${r.approvedUnedited} (${pct(r.uneditedRate)})`,
  },
  { key: "edited", label: "Edited", cell: (r) => r.approvedEdited },
  {
    key: "edit",
    label: "Avg edit",
    cell: (r) => (r.editChars === null ? "-" : `${Math.round(r.editChars)} chars`),
  },
  { key: "rejected", label: "Rejected", cell: (r) => r.rejected },
  { key: "drops", label: "Guard drops", cell: (r) => r.dropped },
  {
    key: "live",
    label: "Live",
    cell: (r) => {
      const n = r.proof.live + r.proof.hidden + r.proof.missing;
      return n ? `${r.proof.live}/${n}` : "-";
    },
  },
  {
    key: "replied",
    label: "Replied",
    cell: (r) => (r.repliable ? `${r.replied}/${r.repliable}` : "-"),
  },
];

export function DraftModels({ demo }: { demo: boolean }) {
  const [open, setOpen] = useState(false);
  // Read once it's opened, and kept: opened again it shows at once while it reads again.
  const got = useCall(open && !demo ? "draft-models:30d" : null, () =>
    call<Scorecard>("console/call", {
      service: "ReachDesk",
      handler: "draftModels",
      input: { since: "30d" },
    }),
  );
  const card = got.data;
  const error = got.error && !card ? got.error.message : null;

  return (
    <details
      className="mb-4 text-[13.5px]"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer font-medium">Draft models</summary>
      {error ? <p className={ERROR}>{error}</p> : null}
      {card ? (
        <div className="mt-2 grid gap-2">
          <p className="m-0">{card.verdict.says}</p>
          <DataTable columns={COLUMNS} data={card.rows} rowKey={(r) => `${r.armed}:${r.by}`} />
          {card.rows.length ? null : (
            <p className={cx("m-0", QUIET)}>No drafts in the last 30 days.</p>
          )}
          <p className={cx("m-0", QUIET)}>
            Last 30 days. Each item is drafted by one model, the same one every time.
          </p>
        </div>
      ) : open && !error ? (
        <p className={cx("mt-2", QUIET)}>Reading…</p>
      ) : null}
    </details>
  );
}
