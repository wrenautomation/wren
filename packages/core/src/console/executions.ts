/**
 * Executions as records: each subject's walk through a workflow (`console.execution`) and its
 * steps, the units held out of a stage and sources paused (`console.hold`), and each check's
 * pass rate (`console.check`).
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { Component } from "../components.js";
import { UNTIL_LABELS } from "../logic.js";
import {
  choice,
  date,
  defineRecord,
  name,
  named,
  number,
  percent,
  status,
  text,
} from "../records.js";
import type { SentEvent } from "../schema.js";
import type { Workflow, WorkflowNode } from "../workflows.js";

/** One step of an execution: what arrived at a node's input, and what its step sent on. */
export interface ExecutionStep {
  id: string;
  node: string;
  port: string;
  kind: string;
  data: Record<string, unknown>;
  at: string;
  due: string | null;
  /** Held at a Wait until this event ("reply"); null for any other step. */
  until: string | null;
  error: string | null;
  sent: SentEvent[] | null;
  sentAt: string | null;
}

/** An execution's id: its workflow and subject, as `executions` keys it. */
export const executionId = (workflow: string, subject: string) => `${workflow}/${subject}`;

/** Every step one subject took through one workflow, in the order it took them. */
export async function executionSteps(db: Queryable, id: string): Promise<ExecutionStep[]> {
  const at = id.indexOf("/");
  if (at < 1) return [];
  const rows = (await db.execute(sql`
    select id::text id, node, port, kind, data, at, due, until, error, sent, sent_at "sentAt"
    from events where workflow = ${id.slice(0, at)} and subject = ${id.slice(at + 1)}
    order by at, id limit 500`)) as unknown as Array<
    Omit<ExecutionStep, "at" | "due" | "sentAt"> & {
      at: Date | string;
      due: Date | string | null;
      sentAt: Date | string | null;
    }
  >;
  const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
  return [...rows].map((r) => ({
    ...r,
    at: iso(r.at) as string,
    due: iso(r.due),
    sentAt: iso(r.sentAt),
  }));
}

/**
 * "Now at" in words for a node inside a part ("follow.wait2"): the part's name, then the touch
 * ("Follow-up: Text 1") or the touch its Wait is after ("Follow-up: after DM 1"). Any other node
 * reads as its id in words.
 */
export function nowAtLabels(
  workflows: readonly Workflow[],
  components: readonly Component[],
): Record<string, string> {
  const parts = new Map(components.map((c) => [c.id, c]));
  const flows = new Map(workflows.map((w) => [w.id, w]));
  const out: Record<string, string> = {};
  for (const w of workflows)
    for (const n of w.nodes) {
      const c = n.uses ? parts.get(n.uses) : undefined;
      const inside = c?.inside ? flows.get(c.inside) : undefined;
      if (!c || !inside) continue;
      const said = (i: WorkflowNode) => (i.note ?? i.id).split(".")[0] as string;
      for (const i of inside.nodes) {
        let words = said(i);
        if (i.uses === "logic.wait") {
          const after = inside.wires
            .filter((x) => x.to === `${i.id}.in`)
            .map((x) => inside.nodes.find((y) => `${y.id}.sent` === x.from))
            .find(Boolean);
          // A Wait before any touch: the part has just started on them.
          words = after ? `after ${said(after)}` : "starting";
        }
        out[`${n.id}.${i.id}`] = `${c.name}: ${words}`;
      }
    }
  return out;
}

/**
 * Wren's executions (`executions`): each subject's walk through a workflow, where it is now
 * and how long since it entered. Its page lights the path and shows each step's data. ponytail:
 * main only, as `console.event`. `labels` says a node inside a part in words.
 */
export const executionRecordOf = (labels: Readonly<Record<string, string>> = {}) =>
  defineRecord({
    id: "console.execution",
    app: "workflows",
    channel: null,
    name: { one: "execution", many: "executions" },
    view: "executions",
    key: "id",
    title: "title",
    subtitle: "workflow",
    fields: {
      title: text("About"),
      // Who it's about apart from the title, so search finds a person or their firm.
      person: name("Person", { listed: false }),
      firm: name("Firm", { listed: false }),
      subject: text("Key", { listed: false }),
      workflow: named("Workflow"),
      // The title says the kind ("Dana Lee: Text lead"), and its page when it entered: the list
      // gives "Now at" the room.
      kind: named("Kind", { listed: false }),
      state: status({
        failed: { label: "Failed", tone: "bad" },
        waiting: { label: "Waiting", tone: "neutral" },
        done: { label: "Done", tone: "good" },
      }),
      node: choice(() => labels, "Now at"),
      entered: date("Entered", { listed: false }),
      lastAt: date("Last step"),
      until: choice(() => UNTIL_LABELS, "Waiting for"),
      due: date("Waiting until"),
      error: text("Why it failed", { words: "reason" }),
      steps: number("Steps"),
    },
    views: [
      { id: "all", label: "All", sort: "-lastAt", at: "entered" },
      { id: "waiting", label: "Waiting", where: { state: "waiting" }, sort: "due", at: "entered" },
      { id: "failed", label: "Failed", where: { state: "failed" }, sort: "-lastAt", at: "entered" },
      { id: "done", label: "Done", where: { state: "done" }, sort: "-lastAt", at: "entered" },
    ],
    // Retry is on its failed step, by that event's id; Replay takes many executions at once.
    load: async (db, id) => ({ steps: await executionSteps(db, id) }),
    actions: ["console.replay"],
  });

export const executionRecord = executionRecordOf();

/**
 * Units held out of a stage and sources paused on one (`./checks.ts`): why, and until when.
 * Release runs a unit again or resumes a source. ponytail: main only, as `console.event`.
 */
export const holdRecord = defineRecord({
  id: "console.hold",
  app: "workflows",
  channel: null,
  name: { one: "hold", many: "holds" },
  view: "unit_holds_now",
  key: "id",
  title: "title",
  subtitle: "stage",
  fields: {
    title: text("What"),
    subject: text("Key", { listed: false }),
    stage: named("Stage"),
    state: status({
      held: { label: "Held 7 days", tone: "warn" },
      due: { label: "Retry due", tone: "neutral" },
      stuck: { label: "Needs a person", tone: "bad" },
      paused: { label: "Source paused", tone: "bad" },
      released: { label: "Released", tone: "good" },
    }),
    reason: text("Why", { words: "reason" }),
    tries: number("Tries"),
    heldAt: date("Held"),
    until: date("Until"),
    releasedBy: text("Released by"),
  },
  views: [
    {
      id: "open",
      label: "Open",
      where: { state: ["held", "due", "stuck", "paused"] },
      sort: "-heldAt",
      at: "heldAt",
    },
    { id: "all", label: "All", sort: "-heldAt", at: "heldAt" },
  ],
  actions: ["console.releaseHold"],
});

/** Each check's pass rate per stage and source over 30 days; under 70% of 50 pauses a source. */
export const checkRecord = defineRecord({
  id: "console.check",
  app: "workflows",
  channel: null,
  name: { one: "check", many: "checks" },
  view: "check_rates",
  key: "id",
  title: "check",
  subtitle: "source",
  fields: {
    check: text("Check"),
    stage: named("Stage"),
    source: named("Source"),
    rate: percent("Passed"),
    passed: number("Passes"),
    total: number("Outcomes"),
    state: status({ paused: { label: "Paused", tone: "bad" }, on: { label: "On", tone: "good" } }),
    lastAt: date("Last"),
  },
  views: [{ id: "all", label: "All", sort: "rate" }],
});
