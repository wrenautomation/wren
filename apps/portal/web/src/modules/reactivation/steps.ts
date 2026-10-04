/** Reactivation's pipeline in words: each step's name, its line on the rail, and where it opens. */
import { num, type RailGroup, type RailStep, soon } from "@wren/ui";
import type { Pipeline, PipelineStep, PipelineStepId } from "../../api.js";
import { at } from "./nav.js";

export const STEP_NAMES: Record<PipelineStepId, string> = {
  list: "Your list",
  emails: "Emails",
  where: "Where now",
  hiring: "Hiring checks",
  score: "Ranked",
  briefs: "Briefs",
  drafts: "Drafts",
  approve: "Your OK",
  sent: "Sent",
  replies: "Replies",
};

const PHASES: { id: string; label: string; steps: PipelineStepId[] }[] = [
  { id: "research", label: "Research", steps: ["list", "emails", "where", "hiring", "score"] },
  { id: "write", label: "Write", steps: ["briefs", "drafts"] },
  { id: "send", label: "Send", steps: ["approve", "sent", "replies"] },
];

const OPENS: Record<PipelineStepId, string> = {
  list: at("people"),
  emails: at("health"),
  where: at("people", { view: "all", now: "moved" }),
  hiring: at("people", { view: "all", now: "hiring" }),
  score: at("people"),
  briefs: at("people"),
  drafts: at("emails", { filter: "all" }),
  approve: at("emails", { filter: "awaiting" }),
  sent: at("emails", { filter: "sent" }),
  replies: at("replies"),
};

/** What finishing looks like for each step, said under it once it's done. */
const DONE: Record<PipelineStepId, (s: PipelineStep) => string> = {
  list: () => "from your CRM",
  emails: (s) => (s.of !== null && s.count === s.of ? "all checked" : "checked"),
  where: (s) => (s.of !== null && s.count === s.of ? "all looked up" : "looked up"),
  hiring: (s) =>
    s.of !== null ? `of ${num(s.of)} ${s.of === 1 ? "company" : "companies"}` : "companies checked",
  score: () => "by why now",
  briefs: () => "each with sources",
  drafts: () => "written",
  approve: () => "all read",
  sent: () => "went out",
  replies: () => "so far",
};

function noteOf(s: PipelineStep, sends: boolean, demo: boolean): string {
  const left = s.of !== null ? s.of - s.count : 0;
  switch (s.state) {
    case "waiting": {
      const when = soon(s.resumesAt);
      return `${num(s.parked)} wait${when ? ` till ${when}` : " for the next pass"}`;
    }
    case "yours":
      return "ready to read";
    case "next":
      return left > 0 ? `${num(left)} to go` : "runs next";
    case "done":
      return DONE[s.id](s);
    case "idle":
      if (s.id === "sent" && !sends) return demo ? "off on the demo" : "off for now";
      return "none yet";
  }
}

export function railOf(p: Pipeline, demo: boolean): RailGroup[] {
  const byId = new Map(p.steps.map((s) => [s.id, s]));
  return PHASES.map((phase) => ({
    id: phase.id,
    label: phase.label,
    steps: phase.steps.flatMap((id): RailStep[] => {
      const s = byId.get(id);
      if (!s) return [];
      return [
        {
          id,
          label: STEP_NAMES[id],
          count: num(s.count),
          note: noteOf(s, p.sends, demo),
          state: s.state,
          href: OPENS[id],
        },
      ];
    }),
  }));
}
