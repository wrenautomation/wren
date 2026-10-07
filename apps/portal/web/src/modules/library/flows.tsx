/**
 * The Library's Workflows: each one's steps, and a link onto the Workflows canvas, or for one
 * saved as a template, to the Marketplace page that installs it, and Delete for Wren's team.
 */
import type { RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { DeleteSaved } from "../marketplace/delete-saved.js";
import { QUIET } from "../work/bits.js";

interface Step {
  id: string;
  name: string;
  note: string | null;
}

export const workflowExtras: NonNullable<ListPage["extras"]> = (detail, { row, team, can }) => {
  const d = detail as { steps?: Step[]; open?: string; saved?: boolean } | null;
  const steps = d?.steps ?? [];
  const link = (
    <a className={`text-[13.5px] ${QUIET}`} href={d?.open ?? "/workflows/canvas"}>
      {d?.saved ? "Install it from the Marketplace" : "Open it in Workflows"}
    </a>
  );
  return {
    lead:
      d?.saved && team && (can?.includes("manage") ?? true) ? (
        <div className="grid justify-items-start gap-3">
          {link}
          <DeleteSaved
            id={String(row.id)}
            name={String(row.name ?? row.id)}
            after="/library/workflows"
          />
        </div>
      ) : (
        link
      ),
    sections: steps.length
      ? [
          [
            "Steps",
            <ol key="steps" className="grid list-decimal gap-2 pl-5 text-[14px]">
              {steps.map((s) => (
                <li key={s.id}>
                  <span className="font-medium">{s.name}</span>
                  {s.note ? <span className="text-(--ui-ink-2)">: {s.note}</span> : null}
                </li>
              ))}
            </ol>,
          ],
        ]
      : [],
  } satisfies RecordExtras;
};
