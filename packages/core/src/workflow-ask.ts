/**
 * Ask Claude on a workflow's graph (designs/2026-10-06-workflow-editor.md, Edit like n8n): "add
 * a text 2 days after the second email if no reply". The prompt is the workflow as data (its
 * nodes and ports, its built-in wires, the draft's routed wires and added nodes) and what may be
 * added. Claude answers `{reply, patch}` with the whole next draft as the patch; the canvas shows
 * it as a diff and Accept makes it the draft. Nothing runs until Publish. Pure.
 */
import type { Component, Port } from "./components.js";
import { LOGIC, logicOf } from "./logic.js";
import type { Workflow, WorkflowEdits } from "./workflows.js";

/** The run rows' record for a workflow's asks (`runs.argv.record`). */
export const WORKFLOW_ASK = "console.workflow";

const SYSTEM = `You edit one workflow on Wren's spine. A workflow is nodes with ports and wires from an output port to an input port of the same kind.
Answer with one JSON object and nothing else: {"reply": "<one or two plain sentences on what you changed>", "patch": {"wires": [...], "steps": [...]}}.
"patch" is the whole next draft: every routed wire and every added node, not only the change. Keep what the draft has unless asked to change it. Use "patch": null when you only answer.
A wire: {"from": "<node>.<port>" or "in.<port>", "to": "<node>.<port>" or "out.<port>", "via": "events", "when"?: "<a rule in plain words>", "wait"?: "<n> minutes|hours|days|weeks"}.
An added node: {"id": "<lowercase_id>", "uses": "<a part, workflow or logic node id from the lists>", "with"?: {<its settings>}}. Never add a custom step.
Built-in wires are the parts' own code: never list them.
Only wire an output into an input of the same kind. Logic nodes take the kind their "kind" setting names.`;

const ports = (ps: readonly Port[]) => ps.map((p) => `${p.id} (${p.kind})`).join(", ") || "none";

/** The prompt: the workflow, the draft, what may be added, and his request. */
export function workflowAskPrompt(o: {
  w: Workflow;
  draft: WorkflowEdits;
  parts: readonly Pick<Component, "id" | "name" | "in" | "out">[];
  flows: readonly Pick<Workflow, "id" | "name" | "in" | "out">[];
  message: string;
}): { question: string; system: string } {
  const portsOf = (uses: string | undefined) =>
    o.parts.find((c) => c.id === uses) ?? o.flows.find((f) => f.id === uses);
  const nodes = o.w.nodes.map((n) => {
    const l = logicOf(n.uses);
    const p = l ? l.ports(n.with ?? {}) : (n.own ?? portsOf(n.uses));
    return `- ${n.id}: ${n.uses ?? "custom step"}; in ${ports(p?.in ?? [])}; out ${ports(p?.out ?? [])}`;
  });
  const logic = LOGIC.filter((l) => l.ready).map(
    (l) =>
      `- ${l.id} (${l.name}): ${l.blurb} Settings: ${l.settings.map((s) => `${s.field}${s.options ? ` (${s.options.join("|")})` : ""}`).join(", ")}`,
  );
  const question = [
    `Workflow ${o.w.id} (${o.w.name}). Its inputs: ${ports(o.w.in)}. Its outputs: ${ports(o.w.out)}.`,
    `Its nodes:\n${nodes.join("\n")}`,
    `Built-in wires (fixed):\n${
      o.w.wires
        .filter((x) => x.via === "code")
        .map((x) => `- ${x.from} -> ${x.to}`)
        .join("\n") || "none"
    }`,
    `The draft now:\n${JSON.stringify(o.draft)}`,
    `Logic nodes you may add:\n${logic.join("\n")}`,
    `Parts you may add:\n${o.parts.map((c) => `- ${c.id} (${c.name}); in ${ports(c.in)}; out ${ports(c.out)}`).join("\n")}`,
    `Workflows you may add:\n${o.flows.map((f) => `- ${f.id} (${f.name}); in ${ports(f.in)}; out ${ports(f.out)}`).join("\n") || "none"}`,
    `His request: ${o.message}`,
  ].join("\n\n");
  return { question, system: SYSTEM };
}

/** Claude's patch as a draft, or null when it isn't one: wires and steps arrays. */
export function patchOf(patch: unknown): WorkflowEdits | null {
  if (!patch || typeof patch !== "object") return null;
  const p = patch as { wires?: unknown; steps?: unknown; settings?: unknown };
  if (!Array.isArray(p.wires) || !Array.isArray(p.steps ?? [])) return null;
  const settings =
    p.settings && typeof p.settings === "object" && !Array.isArray(p.settings)
      ? { settings: p.settings as WorkflowEdits["settings"] }
      : {};
  return { wires: p.wires, steps: (p.steps ?? []) as never, ...settings } as WorkflowEdits;
}
