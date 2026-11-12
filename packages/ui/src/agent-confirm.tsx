/**
 * The agent asks before a risky act (designs/2026-11-11-agent-panel.md, D2): send, spend, delete
 * or publish. The act waits in `agent_confirms`; Yes here is the only way it runs. No can carry a
 * why, which goes back to the agent. Once answered, the card keeps one line of who and when.
 */
import { type ReactNode, useState } from "react";
import { Button } from "./controls.js";
import { useEdit } from "./data/use-edit.js";
import { relative } from "./fields.js";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";

export type RiskyAct = "send" | "spend" | "delete" | "publish";

export interface AgentConfirm {
  id: string;
  act: RiskyAct;
  /** The act in words, as the Yes button says it: "Send 12 emails". */
  title: string;
  /** What it touches, a line each: ["To", "12 leads in Bakeries, Toronto"]. */
  facts: readonly (readonly [string, ReactNode])[];
  /** A look at what goes out: the first email, the ad, the rows removed. */
  preview?: ReactNode;
  state: "asks" | "yes" | "no" | "gone";
  /** Who answered, and when. */
  by?: string | undefined;
  at?: string | undefined;
  /** No's why. */
  why?: string | undefined;
}

const LOOK: Record<RiskyAct, { icon: IconName; tint: string; word: string }> = {
  send: { icon: "send", tint: "bg-(--ui-needs-tint) text-(--ui-needs)", word: "Sends" },
  spend: { icon: "dollar", tint: "bg-(--ui-warn-tint) text-(--ui-warn-ink)", word: "Spends" },
  delete: { icon: "trash", tint: "bg-(--ui-bad-tint) text-(--ui-bad)", word: "Removes" },
  publish: { icon: "globe", tint: "bg-(--ui-accent-tint) text-(--ui-live)", word: "Goes live" },
};

export function ConfirmCard({
  c,
  onAnswer,
}: {
  c: AgentConfirm;
  onAnswer: (yes: boolean, why?: string) => Promise<void>;
}) {
  const look = LOOK[c.act];
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [saying, setSaying] = useState(false);
  // a why half typed survives a reload or a closed panel
  const why = useEdit(`agent-confirm-why:${c.id}`, "");
  const answer = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    await onAnswer(yes, yes ? undefined : why.value.trim() || undefined)
      .then(() => why.saved())
      .finally(() => setBusy(null));
  };
  const asks = c.state === "asks";
  return (
    <fieldset
      aria-label={`Confirm: ${c.title}`}
      className={cx(
        "m-0 grid min-w-0 border-0 gap-3 rounded-[14px] bg-(--ui-paper) p-3.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]",
        !asks && "bg-transparent",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cx("grid size-8 flex-none place-items-center rounded-full", look.tint)}>
          <Icon name={look.icon} size={15} />
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[12px] font-medium text-(--ui-ink-3)">
            {asks ? `The agent asks first · ${look.word}` : look.word}
          </span>
          <span
            className={cx(
              "text-[14.5px]/[1.4] font-semibold wrap-anywhere text-(--ui-ink)",
              c.state === "no" && "text-(--ui-ink-2)",
            )}
          >
            {c.title}
          </span>
        </span>
      </div>
      {asks ? (
        <>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]/[1.45]">
            {c.facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-(--ui-ink-3)">{k}</dt>
                <dd className="m-0 min-w-0 wrap-anywhere text-(--ui-ink)">{v}</dd>
              </div>
            ))}
          </dl>
          {c.preview ? (
            <div className="max-h-48 overflow-y-auto rounded-[10px] bg-(--ui-canvas) p-3 text-[13px]/[1.5] text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)]">
              {c.preview}
            </div>
          ) : null}
          {saying ? (
            <label className="grid gap-1.5 [animation:ui-fade_.15s_both]">
              <span className="text-[12.5px] text-(--ui-ink-2)">
                Why not? The agent reads this.
              </span>
              <textarea
                rows={2}
                {...why.field}
                className="w-full resize-none rounded-[10px] bg-(--ui-paper) px-3 py-2 text-[13.5px] text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)] outline-none focus:shadow-[inset_0_0_0_1px_var(--ui-ink-3)]"
              />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" busy={busy === "yes"} disabled={!!busy} onClick={() => answer(true)}>
              {c.title}
            </Button>
            <Button
              size="sm"
              tone="secondary"
              busy={busy === "no"}
              disabled={busy === "yes"}
              onClick={() => (saying ? answer(false) : setSaying(true))}
            >
              {saying ? "Tell the agent no" : "No"}
            </Button>
          </div>
        </>
      ) : (
        <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-(--ui-ink-2)">
          <Icon
            name={c.state === "yes" ? "checkCircle" : c.state === "no" ? "xCircle" : "clock"}
            size={13}
            className={c.state === "yes" ? "text-(--ui-good)" : "text-(--ui-ink-3)"}
          />
          <span className="wrap-anywhere">
            {c.state === "yes"
              ? `Yes from ${c.by ?? "you"}`
              : c.state === "no"
                ? `No from ${c.by ?? "you"}${c.why ? `: “${c.why}”` : ""}`
                : "The chat ended before an answer. Nothing ran."}
            {c.at ? ` · ${relative(new Date(c.at))}` : ""}
          </span>
        </p>
      )}
    </fieldset>
  );
}
