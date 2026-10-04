/**
 * Copy experiments in Outbound: each experiment's versions and settings, and the copy the model
 * writes, waiting on William. Nothing the model writes goes live until he approves it.
 */
import { FITNESS_NAMES, SEEDING_NAMES, SELECTION_NAMES } from "@wren/experiments/names";
import {
  type Action,
  type FormField,
  HandlerForm,
  Lineage,
  type LineageVersion,
  type RecordExtras,
} from "@wren/ui";
import { createElement } from "react";
import { call } from "../../api.js";
import type { ListPage } from "../../module.js";

const said = (line: string) => () => line;
const count = (answer: unknown, one: string, many: string) => {
  const n = (answer as { done?: unknown[] } | null)?.done?.length ?? 0;
  return n === 1 ? one : `${n} ${many}`;
};

export const EXPERIMENT_ACTIONS: Action[] = [
  {
    id: "email.startExperiment",
    label: "Start experiment",
    handler: "email/startExperiment",
    form: [
      { field: "niche", label: "Campaign", hint: "recruiting, agencies" },
      { field: "template", label: "Template", hint: "book-first/opener" },
      {
        field: "selection",
        label: "Selection",
        type: "select",
        options: SELECTION_NAMES,
        optional: true,
      },
      {
        field: "fitness",
        label: "Counts as a win",
        type: "select",
        options: FITNESS_NAMES,
        optional: true,
      },
      {
        field: "seeding",
        label: "Seeding",
        type: "select",
        options: SEEDING_NAMES,
        optional: true,
        hint: "Left empty: the template's own options. A model seed queues model copy for you.",
      },
      {
        field: "from",
        label: "Winners from experiment",
        type: "number",
        optional: true,
        hint: "Only when seeding from winners.",
      },
    ],
    done: (a) => `Experiment ${(a as { id?: number }).id ?? ""} started`,
  },
  {
    id: "email.pauseExperiment",
    label: "Pause",
    handler: "email/pauseExperiment",
    undo: "email/resumeExperiment",
    bulk: true,
    when: { state: ["running"] },
    done: said("Paused"),
  },
  {
    id: "email.resumeExperiment",
    label: "Resume",
    handler: "email/resumeExperiment",
    undo: "email/pauseExperiment",
    bulk: true,
    when: { state: ["paused", "settled"] },
    done: said("Running again"),
  },
  {
    id: "email.stopExperiment",
    label: "Stop",
    handler: "email/stopExperiment",
    confirm: "Stop it for good? The template file takes its copy back.",
    when: { state: ["running", "paused", "settled"] },
    done: said("Stopped"),
  },
];

const WAITING = { state: ["candidate"] };
export const CANDIDATE_ACTIONS: Action[] = [
  {
    id: "email.approveCandidate",
    label: "Approve",
    handler: "email/approveCandidate",
    confirm: "Put this copy live?",
    key: "a",
    bulk: true,
    when: WAITING,
    done: (a) => `${count(a, "Live", "live")}. The queue picks it up now.`,
  },
  {
    id: "email.editCandidate",
    label: "Edit and approve",
    handler: "email/approveCandidate",
    ask: { field: "text", label: "Your words", from: "text" },
    key: "e",
    when: WAITING,
    done: said("Your words are live"),
  },
  {
    id: "email.rejectCandidate",
    label: "Reject",
    handler: "email/rejectCandidate",
    confirm: "Turn this copy down? The model sees it was rejected.",
    key: "r",
    bulk: true,
    when: WAITING,
    done: (a) => count(a, "Rejected", "rejected"),
  },
];

/** An experiment's panel: its versions as a graph, then its settings as a form. */
export const experimentExtras: NonNullable<ListPage["extras"]> = (detail, { row }) => {
  const d = detail as { lineage?: LineageVersion[]; settings?: FormField[] } | null;
  const id = String(row.id);
  return {
    sections: [
      ["Versions", createElement(Lineage, { versions: d?.lineage ?? [] })],
      [
        "Settings",
        createElement(HandlerForm, {
          key: id,
          id: `experiment-settings-${id}`,
          name: "switchExperiment",
          fields: d?.settings ?? [],
          keyed: false,
          effect: null,
          run: async (c) => {
            const settings = (c.input ?? {}) as Record<string, unknown>;
            if (!Object.keys(settings).length) throw new Error("Type a new value first.");
            await call("email/switchExperiment", { ids: [id], settings });
            return `Saved. ${Object.keys(settings).join(", ")} changed from the next tick.`;
          },
        }),
      ],
    ],
  } satisfies RecordExtras;
};

type Winner = {
  text: string;
  share: number | null;
  p_best: number | null;
  exposures: number;
  interested: number;
};
const pct = (n: number | null) => (n === null ? "no data" : `${Math.round(n * 100)}%`);

/** A candidate beside the live copy at its point, best first. */
export const candidateExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const winners = (detail as { winners?: Winner[] } | null)?.winners ?? [];
  return {
    sections: [
      [
        "Live at this point",
        winners.length ? (
          <ul key="winners" className="grid gap-3 text-[14px]">
            {winners.map((w) => (
              <li key={w.text} className="grid gap-0.5">
                <span>{w.text}</span>
                <span className="text-[13px] text-(--ui-ink-2)">
                  {pct(w.share)} of sends · {pct(w.p_best)} chance it's best · {w.interested}{" "}
                  interested of {w.exposures}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          "Nothing live here yet."
        ),
      ],
    ],
  } satisfies RecordExtras;
};
