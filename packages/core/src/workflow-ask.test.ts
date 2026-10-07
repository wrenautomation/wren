import { describe, expect, it } from "vitest";
import { patchOf, WORKFLOW_ASK, workflowAskPrompt } from "./workflow-ask.js";
import { defineWorkflow } from "./workflows.js";

const lead = { id: "leads", label: "leads", kind: "lead" as const };
const reply = { id: "replied", label: "replies", kind: "reply" as const };
const w = defineWorkflow({
  id: "outreach",
  name: "Outreach",
  blurb: "",
  icon: "mail",
  for: "client",
  stage: "reach",
  in: [lead],
  out: [reply],
  nodes: [
    { id: "mail", uses: "email" },
    { id: "vip", uses: "logic.if", with: { when: "a vip", kind: "lead" } },
  ],
  wires: [
    { from: "in.leads", to: "mail.leads", via: "code" },
    { from: "mail.replied", to: "out.replied", via: "events" },
  ],
});
const parts = [{ id: "email", name: "Email", in: [lead], out: [reply] }];

describe("workflowAskPrompt", () => {
  it("gives Claude the graph, the draft, what may be added, and the request", () => {
    const draft = {
      wires: [{ from: "mail.replied", to: "out.replied", via: "events" as const }],
      steps: [],
    };
    const { question, system } = workflowAskPrompt({
      w,
      draft,
      parts,
      flows: [],
      message: "add a text after the email",
    });
    expect(question).toContain("- mail: email; in leads (lead); out replied (reply)");
    expect(question).toContain("- vip: logic.if; in in (lead); out yes (lead), no (lead)");
    expect(question).toContain("- in.leads -> mail.leads");
    expect(question).toContain(JSON.stringify(draft));
    expect(question).toContain("- logic.wait (Wait)");
    // Triggers still in development aren't offered.
    expect(question).toContain("trigger.schedule (Schedule)");
    expect(question).toContain("His request: add a text after the email");
    expect(system).toContain('"patch"');
    expect(WORKFLOW_ASK).toBe("console.workflow");
  });
});

describe("patchOf", () => {
  it("reads a whole draft and refuses anything else", () => {
    expect(patchOf({ wires: [], steps: [] })).toEqual({ wires: [], steps: [] });
    expect(patchOf({ wires: [{ from: "a.b", to: "c.d", via: "events" }] })).toEqual({
      wires: [{ from: "a.b", to: "c.d", via: "events" }],
      steps: [],
    });
    expect(patchOf(null)).toBeNull();
    expect(patchOf({ wires: "x" })).toBeNull();
    expect(patchOf({ steps: [] })).toBeNull();
  });
});
