/**
 * The workflow Canvas's answers: one small workflow (`wren`: leads in, a first touch, a follow-up,
 * replies out) and the editor's writes (save, publish, ask Claude, a dry test). Synthetic; the
 * repo is public.
 */
import type { RecordAnswer } from "@wren/core/records/serve";
import type { Drawn } from "../../modules/marketplace/boxes.js";
import type { DryResult } from "../../modules/wren/dry.js";
import type { Draft } from "../../modules/wren/wiring.js";
import type { Answers } from "../api.js";

type Reply = (body: Record<string, unknown>) => unknown;

const lead = (id: string) => ({ id, label: id, kind: "lead" as const });
const reply = (id: string) => ({ id, label: id, kind: "reply" as const });

export const CANVAS_WORKFLOW: Drawn = {
  id: "wren",
  name: "Wren",
  in: [lead("leads")],
  out: [reply("replied")],
  nodes: [
    {
      id: "touch",
      uses: "touch",
      name: "First touch",
      note: null,
      ready: "ready",
      in: [lead("leads")],
      out: [lead("sent"), reply("replied")],
    },
    {
      id: "follow",
      uses: "follow",
      name: "Follow-up",
      note: null,
      ready: "ready",
      in: [lead("lead")],
      out: [reply("replied")],
    },
  ],
  wires: [
    { from: "in.leads", to: "touch.leads", via: "code", label: "leads" },
    { from: "touch.replied", to: "out.replied", via: "events", label: "replied" },
    { from: "follow.replied", to: "out.replied", via: "events", label: "replied" },
  ],
};

/** What runs live, as a draft: the routed wires (`draftOf`). */
const LIVE: Draft = {
  wires: [
    { from: "touch.replied", to: "out.replied", via: "events" },
    { from: "follow.replied", to: "out.replied", via: "events" },
  ],
  steps: [],
};

/** Claude's answer to "follow up on the ones that don't reply": one wire more. */
export const CANVAS_PATCH: Draft = {
  ...LIVE,
  wires: [...LIVE.wires, { from: "touch.sent", to: "follow.lead", via: "events", wait: "2 days" }],
};

export const CANVAS_DETAIL = {
  workflow: CANVAS_WORKFLOW,
  saved: null,
  broken: [],
  draft: null,
  versions: [],
  code: LIVE,
  forClients: false,
  templates: [],
};

/** A dry run from `in.leads`: it reached the first touch and went out as a reply. */
export const CANVAS_DRY: DryResult = {
  steps: [
    {
      node: "touch",
      port: "leads",
      subject: "Sam Test",
      at: 0,
      in: { name: "Sam Test" },
      out: [{ port: "replied", data: { channel: "sms" } }],
    },
  ],
  tally: { arrived: 1, seen: 1, waiting: 0, failed: 0, out: 1 },
  capped: false,
};

/** The Canvas's reads and writes over `base`: the workflow's record, and each editor write. */
export function canvasAnswers(base: Answers): Answers {
  const get = base["console/recordsGet"] as Reply;
  return {
    "console/recordsGet": (b) =>
      b.record === "console.component"
        ? ({
            record: "console.component",
            row: { id: String(b.id) },
            related: [],
            activity: [],
            detail: b.id === CANVAS_WORKFLOW.id ? CANVAS_DETAIL : null,
          } as unknown as RecordAnswer)
        : get(b),
    "console/workflowsMade": [],
    "console/workflowSave": { id: 2 },
    "console/workflowPublish": { id: 3 },
    "console/workflowDiscard": {},
    "console/workflowAsk": { id: "ask-1" },
    "console/workflowAnswer": {
      state: "done",
      reply: "Added a follow-up 2 days after the first touch.",
      patch: CANVAS_PATCH,
    },
    "console/workflowTest": CANVAS_DRY,
  };
}
