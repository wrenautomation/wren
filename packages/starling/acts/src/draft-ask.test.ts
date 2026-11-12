/**
 * The Ask Claude draft prompt moved into the template store must reach Claude byte for byte as
 * the code built it. The legacy builder is that code, kept here verbatim. Synthetic drafts only.
 */
import { describe, expect, it } from "vitest";
import { askPrompt, draftAskDefault } from "./draft-ask.js";
import type { DraftItem } from "./draft-kinds.js";

const ASK_DRAFT_MAX = 5000;
const QUESTION_MAX = 4000;
const SYSTEM_MAX = 8000;

const DRAFT_SYSTEM = `You help William finish one draft before he sends it himself: a post, an answer to a comment, a comment in a thread or a message. You are read only: you can't change, send or post anything, so never say you did. Wren writes the draft you give.
Answer with one JSON object and nothing else: {"reply": "...", "draft": "..."}.
- reply: what you changed, or your answer to his question. A sentence or two, plain text.
- draft: the whole new draft, ready to send as is. null when he only asked something or nothing should change.
Write as William: "I", casual, short paragraphs, plain words, no em dashes. Keep under the cap.`;

function legacyAsk(
  d: DraftItem,
  ask: { by: string; message: string },
): { question: string; system: string } | { error: string } {
  if ((d.draft?.length ?? 0) > ASK_DRAFT_MAX)
    return { error: `the draft is over ${ASK_DRAFT_MAX} characters; use wren content review set` };
  const head = `${DRAFT_SYSTEM}\n\nIt is a ${d.what}, at most ${d.max} characters.\n\nThe draft now:\n${
    d.draft ? `"""\n${d.draft}\n"""` : "(none yet)"
  }`;
  // His edits and his past comment decisions before the SOP: the cut takes the end.
  const edits = d.edits ? `\n\n${d.edits}` : "";
  const examples = d.examples ? `\n\n${d.examples}` : "";
  const guide = d.guide ? `\n\nHow we write here:\n${d.guide}` : "";
  return {
    question: `${ask.by} asks: ${ask.message}\n\n${d.context}`.slice(0, QUESTION_MAX),
    system: (head + edits + examples + guide).slice(0, SYSTEM_MAX),
  };
}

const ask = { by: "william", message: "Shorter, and {keep} the hook" };
const item: DraftItem = {
  what: "LinkedIn post",
  title: "t",
  draft: "First line.\n\nSecond {line} with ((parens)) and [[brackets]].",
  max: 3000,
  open: true,
  context: "The post: example.",
  guide: "Short lines.",
  edits: "His last edits:\n- cut the intro",
};

describe("the draft ask prompt as a template", () => {
  it("the draft prompt renders what the code built", () => {
    const items: DraftItem[] = [
      item,
      (({ edits: _, ...rest }) => ({ ...rest, draft: null, guide: "" }))(item),
      { ...item, draft: "", edits: "" },
      { ...item, guide: "x".repeat(9000) },
      { ...item, draft: "y".repeat(5001) },
      { ...item, examples: 'His past decisions on comment drafts:\n1. Draft: "{x}"\nHe sent it.' },
      { ...item, edits: "", examples: "His past decisions on comment drafts: one." },
    ];
    for (const d of items) expect(askPrompt(d, ask)).toEqual(legacyAsk(d, ask));
    expect(draftAskDefault().version).toMatch(/^[0-9a-f]{12}$/);
  });
});
