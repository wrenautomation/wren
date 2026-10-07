/** The Library's Workflows: each one's steps, and a link onto the Workflows canvas. */
import type { RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";

interface Step {
  id: string;
  name: string;
  note: string | null;
}

export const workflowExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as { steps?: Step[]; open?: string } | null;
  const steps = d?.steps ?? [];
  return {
    lead: (
      <a className={`text-[13.5px] ${QUIET}`} href={d?.open ?? "/workflows/canvas"}>
        Open it in Workflows
      </a>
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
