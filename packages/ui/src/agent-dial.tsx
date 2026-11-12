/**
 * How far the agent may act alone for one client (designs/2026-11-11-agent-panel.md, D2): per
 * risky act, Auto, Ask first or Never. Every other change runs and shows in Changes, with Undo.
 */
import type { RiskyAct } from "./agent-confirm.js";
import { Seg } from "./controls.js";

export type Autonomy = "auto" | "approve" | "off";

const ACTS: readonly (readonly [RiskyAct, string, string])[] = [
  ["send", "Send", "Emails, texts, DMs and posts to people outside Wren."],
  ["spend", "Spend", "Ad budgets, paid lookups, bills."],
  ["delete", "Delete", "Removes records for good."],
  ["publish", "Publish", "Pages, sites and posts going live."],
];

const LEVELS = [
  ["auto", "Auto"],
  ["approve", "Ask first"],
  ["off", "Never"],
] as const;

export function AutonomyDial({
  value,
  onChange,
}: {
  value: Readonly<Record<RiskyAct, Autonomy>>;
  onChange: (act: RiskyAct, to: Autonomy) => void;
}) {
  return (
    <div className="grid gap-4">
      <p className="m-0 max-w-[60ch] text-[13.5px]/[1.5] text-(--ui-ink-2)">
        What the agent may do on its own here. Every other change runs at once and shows in its
        chat's Changes, with Undo.
      </p>
      {ACTS.map(([act, name, what]) => (
        <div
          key={act}
          className="grid items-center gap-x-6 gap-y-2 min-[560px]:grid-cols-[1fr_minmax(0,280px)]"
        >
          <span className="grid gap-0.5">
            <span className="text-[14px] font-medium text-(--ui-ink)">{name}</span>
            <span className="text-[12.5px] text-(--ui-ink-3)">{what}</span>
          </span>
          <Seg
            label={`${name}: what the agent may do`}
            fill
            value={value[act]}
            items={LEVELS.map(([v, l]) => ({ value: v, label: l }))}
            onChange={(v) => onChange(act, v)}
          />
        </div>
      ))}
    </div>
  );
}
