import { describe, expect, it } from "vitest";
import { isSite } from "./answers.js";
import { applyProposals, pullRequestBody } from "./apply.js";
import { type ProposalDraft, refusal, wordsChanged } from "./propose.js";
import type { SearchProposal } from "./schema.js";

const site =
  "Page /agencies\ntitle: Automation for agencies\n\nWe set it up in 14 days. You only pay when it works.";
const draft = (p: Partial<ProposalDraft>): ProposalDraft => ({
  page: "/agencies",
  kind: "copy",
  current: "You only pay when it works.",
  proposed: "You pay only when it books meetings.",
  why: "answers the cost question",
  keywords: [],
  ...p,
});

describe("refusal", () => {
  it("passes an edit that quotes the site and adds no numbers", () => {
    expect(refusal(draft({}), site)).toBeNull();
  });
  it("refuses a quote the site doesn't have, a price, a dash, an invented number", () => {
    expect(refusal(draft({ current: "Not on the page." }), site)).toMatch(/not found/);
    expect(refusal(draft({ proposed: "From $500 a meeting." }), site)).toMatch(/price/);
    expect(refusal(draft({ proposed: "You pay only when it works — always." }), site)).toMatch(
      /dash/,
    );
    expect(refusal(draft({ proposed: "Live in 7 days." }), site)).toMatch(/number/);
    expect(
      refusal(
        draft({ current: "We set it up in 14 days.", proposed: "We go live in 14 days." }),
        site,
      ),
    ).toBeNull();
  });
  it("needs a quote; a new FAQ or page is a note", () => {
    expect(refusal(draft({ kind: "title", current: "" }), site)).toMatch(/no current/);
    expect(
      refusal(
        draft({ kind: "faq", current: "", proposed: "Q: Who is it for?\nA: Agencies." }),
        site,
      ),
    ).toMatch(/note/);
  });
  it("caps the words an edit changes", () => {
    expect(wordsChanged("You only pay when it works.", "You pay only when it works.")).toBe(2);
    expect(wordsChanged("a b c", "a b c")).toBe(0);
    expect(refusal(draft({ proposed: "You only pay when it books meetings." }), site)).toBeNull();
    expect(
      refusal(
        draft({ proposed: "Payment happens after the system books your first real meetings." }),
        site,
      ),
    ).toMatch(/words/);
    expect(refusal(draft({ proposed: "You only pay when it works." }), site)).toMatch(/no change/);
  });
});

const proposal = (
  id: number,
  current: string,
  proposed: string,
  kind: SearchProposal["kind"] = "copy",
): SearchProposal => ({
  id,
  madeOn: "2026-09-30",
  page: "/agencies",
  kind,
  current,
  proposed,
  why: "why",
  keywords: ["agency automation"],
  state: "open",
  pr: null,
  llm: null,
  runId: null,
});

describe("applyProposals", () => {
  const files = [
    { path: "a.yaml", text: "title: Automation for agencies\nbody: Same words. Same words." },
    { path: "b.yaml", text: "title: Other\nline: Unique line here." },
  ];
  it("applies a quote found once and leaves the rest for a person", () => {
    const a = applyProposals(files, [
      proposal(1, "Unique line here.", "A better line."),
      proposal(2, "Same words.", "Changed."),
      proposal(3, "Nowhere.", "x"),
      proposal(4, "", "Q: ?\nA: .", "faq"),
    ]);
    expect(a.applied.map((p) => p.id)).toEqual([1]);
    expect(a.files).toEqual([{ path: "b.yaml", text: "title: Other\nline: A better line." }]);
    expect(a.byHand.map((b) => [b.proposal.id, b.reason])).toEqual([
      [2, "quoted text found 2 times"],
      [3, "quoted text not in the source"],
      [4, "new text to place"],
    ]);
    expect(pullRequestBody(a)).toContain("## By hand (3)");
  });
  it("keeps a $ in the proposed text literal", () => {
    const a = applyProposals(files, [proposal(1, "Unique line here.", "Costs $& less.")]);
    expect(a.files[0]?.text).toContain("Costs $& less.");
  });
});

describe("isSite", () => {
  it("matches the host, www and subdomains only", () => {
    expect(isSite("https://www.example.com/a", "example.com")).toBe(true);
    expect(isSite("https://app.example.com", "example.com")).toBe(true);
    expect(isSite("https://notexample.com", "example.com")).toBe(false);
    expect(isSite("not a url", "example.com")).toBe(false);
  });
});
