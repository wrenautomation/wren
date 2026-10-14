/**
 * Marketing → Engage: which model writes reach drafts, and how each one's drafts fared
 * (designs/2026-10-14-draft-models.md). Shut by default; it reads when opened. The table is
 * `ReachDesk.draftModels`; the arms are set with `wren drafts models set`.
 */
import type { Scorecard } from "@wren/core/draft-models";
import { cx } from "@wren/ui";
import { useEffect, useState } from "react";
import { ApiError, call } from "../../api.js";
import { ERROR, QUIET } from "../work/bits.js";

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

export function DraftModels({ demo }: { demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<Scorecard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || demo || card) return;
    call<Scorecard>("console/call", {
      service: "ReachDesk",
      handler: "draftModels",
      input: { since: "30d" },
    }).then(setCard, (err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [open, demo, card]);

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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className={QUIET}>
                <tr>
                  {[
                    "Model",
                    "Drafts",
                    "Unedited",
                    "Edited",
                    "Avg edit",
                    "Rejected",
                    "Guard drops",
                    "Live",
                    "Replied",
                  ].map((h) => (
                    <th key={h} className="whitespace-nowrap py-1 pr-4 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {card.rows.map((r) => (
                  <tr key={`${r.armed}:${r.by}`} className="border-t border-(--ui-hair)">
                    <td className={cx("py-1 pr-4", r.armed ? "font-medium" : QUIET)} title={r.by}>
                      {r.label}
                    </td>
                    <td className="py-1 pr-4">{r.generated}</td>
                    <td className="py-1 pr-4">
                      {r.approvedUnedited} ({pct(r.uneditedRate)})
                    </td>
                    <td className="py-1 pr-4">{r.approvedEdited}</td>
                    <td className="py-1 pr-4">
                      {r.editChars === null ? "-" : `${Math.round(r.editChars)} chars`}
                    </td>
                    <td className="py-1 pr-4">{r.rejected}</td>
                    <td className="py-1 pr-4">{r.dropped}</td>
                    <td className="py-1 pr-4">
                      {r.proof.live + r.proof.hidden + r.proof.missing
                        ? `${r.proof.live}/${r.proof.live + r.proof.hidden + r.proof.missing}`
                        : "-"}
                    </td>
                    <td className="py-1 pr-4">
                      {r.repliable ? `${r.replied}/${r.repliable}` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {card.rows.length ? null : (
            <p className={cx("m-0", QUIET)}>No drafts in the last 30 days.</p>
          )}
          <p className={cx("m-0", QUIET)}>
            Last 30 days. Split by item, set with <code>wren drafts models set</code>.
          </p>
        </div>
      ) : open && !error ? (
        <p className={cx("mt-2", QUIET)}>Reading…</p>
      ) : null}
    </details>
  );
}
