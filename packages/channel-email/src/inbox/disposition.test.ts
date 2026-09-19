/** The reply-disposition graph on a FakeLlm, no database: the one LLM step proposes, the grounding gate disposes. */
import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  type DispositionState,
  ground,
  MIN_CONFIDENCE,
  type Proposal,
  route,
  runGraph,
} from "./disposition.js";

const REPLY = "Thanks William — yes, let's talk. Can you do Thursday at 10?";

function stateFor(text = REPLY, ours: Partial<DispositionState["ours"]> = {}): DispositionState {
  return {
    event: { id: 7, from_address: "jane@oakbridge.example", subject: "Re: x", text },
    ours: {
      step: 0,
      template: "opener",
      subject: "automation at Oakbridge",
      body: "Hi Jane,\n\nI build automations.",
      to_email: "jane@oakbridge.example",
      ...ours,
    },
    company: { name: "Oakbridge", domain: "oakbridge.example" },
  };
}

const answering = (proposal: Record<string, unknown>) =>
  new FakeLlm({ respond: () => JSON.stringify(proposal) });

const gate = (state: DispositionState, proposal: Proposal) =>
  ground(state, { proposal, llm: null, parse_error: null, provider_rejected: null });

describe("the disposition graph", () => {
  it("a grounded, confident proposal becomes the label", async () => {
    const llm = answering({
      disposition: "interested",
      evidence: "yes, let's talk",
      confidence: 0.95,
      reason: "asks for a slot",
    });
    const result = await runGraph(llm, stateFor());
    expect(result.verdict).toEqual({
      disposition: "interested",
      grounded: true,
      reason: "grounded",
    });
    expect(result.proposal?.evidence).toBe("yes, let's talk");
    expect(result.llm?.call?.provider).toBe("fake"); // the audit envelope rides along
    expect(result.parse_error).toBeNull();
  });

  it("evidence the reply does not contain is not grounded", async () => {
    const llm = answering({
      disposition: "interested",
      evidence: "send me a proposal",
      confidence: 0.9,
    });
    const result = await runGraph(llm, stateFor());
    expect(result.verdict.disposition).toBeNull();
    expect(result.verdict.grounded).toBe(false);
    expect(result.verdict.reason).toContain("not in the reply");
    expect(result.proposal?.disposition).toBe("interested"); // recorded, never applied
  });

  it("grounding folds case and whitespace but nothing else", () => {
    expect(
      gate(stateFor("Yes,\n  LET'S   talk next week."), {
        disposition: "not_now",
        evidence: "let's talk NEXT week",
        confidence: 0.8,
      }).grounded,
    ).toBe(true);
    expect(
      gate(stateFor("Yes, let's talk next week."), {
        disposition: "not_now",
        evidence: "lets talk",
        confidence: 0.8,
      }).grounded,
    ).toBe(false);
  });

  it.each<[Proposal, string]>([
    [{ disposition: "maybe", evidence: "yes", confidence: 0.9 }, "not in the vocabulary"],
    [{ disposition: "interested", evidence: "", confidence: 0.9 }, "not in the reply"],
    [{ disposition: "interested", evidence: "yes", confidence: MIN_CONFIDENCE - 0.01 }, "below"],
    [{ disposition: "interested", evidence: "yes" }, "below"],
  ])("the gate refuses each way a proposal can fail: %j", (proposal, fragment) => {
    const verdict = gate(stateFor(), proposal);
    expect(verdict.disposition).toBeNull();
    expect(verdict.reason).toContain(fragment);
  });

  it("an unparseable answer is recorded as a parse error and leaves no label", async () => {
    const result = await runGraph(new FakeLlm({ default: "I think they are keen!" }), stateFor());
    expect(result.proposal).toBeNull();
    expect(result.parse_error).toBeTruthy();
    expect(result.verdict.disposition).toBeNull();
    expect(result.verdict.reason).toBe(result.parse_error);
  });

  it("a reply with no words buys nothing", async () => {
    const calls: string[] = [];
    const llm = new FakeLlm({
      respond: (prompt) => {
        calls.push(prompt);
        return "{}";
      },
    });
    const result = await runGraph(llm, stateFor("   "));
    expect(calls).toEqual([]);
    expect(result.llm).toBeNull();
    expect(result.verdict.reason).toBe("no reply text");
    expect(route(stateFor(""))).toBe("no_text");
    expect(route(stateFor())).toBe("classify");
  });

  it("the prompt carries both sides and caps our own body", () => {
    const prompt = buildPrompt(stateFor(REPLY, { body: "x".repeat(5000) }));
    expect(prompt).toContain(REPLY);
    expect(prompt).toContain("automation at Oakbridge");
    expect(prompt).toContain("jane@oakbridge.example");
    expect(prompt).toContain("x".repeat(1500));
    expect(prompt).not.toContain("x".repeat(1501));
    for (const label of [
      "interested",
      "meeting_booked",
      "not_interested",
      "not_now",
      "wrong_person",
    ]) {
      expect(prompt).toContain(`- ${label}:`);
    }
    expect(prompt).toContain("- referral:");
    expect(prompt).toContain("- other:");
  });
});
