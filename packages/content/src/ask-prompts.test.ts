/**
 * The two Ask Claude prompts moved into the template store must reach Claude byte for byte as the
 * code built them. The legacy builders are that code, kept here verbatim. Synthetic drafts only.
 */
import type { VideoEdit } from "@wren/studio/schema";
import { describe, expect, it } from "vitest";
import { askPrompt, type DraftItem, draftAskDefault } from "./draft-ask.js";
import { videoAskDefault, videoPrompt } from "./video-ask.js";

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
    return { error: `the draft is over ${ASK_DRAFT_MAX} characters; use wren drafts set` };
  const head = `${DRAFT_SYSTEM}\n\nIt is a ${d.what}, at most ${d.max} characters.\n\nThe draft now:\n${
    d.draft ? `"""\n${d.draft}\n"""` : "(none yet)"
  }`;
  // His edits before the SOP: the cut takes the end, and his edits say the most.
  const edits = d.edits ? `\n\n${d.edits}` : "";
  const guide = d.guide ? `\n\nHow we write here:\n${d.guide}` : "";
  return {
    question: `${ask.by} asks: ${ask.message}\n\n${d.context}`.slice(0, QUESTION_MAX),
    system: (head + edits + guide).slice(0, SYSTEM_MAX),
  };
}

const VIDEO_SYSTEM = `You help William edit one of his videos before it renders. You are read only: you can't change, render or upload anything, so never say you did. Wren applies the patch you give.
Answer with one JSON object and nothing else: {"reply": "...", "patch": {...}}.
- reply: what you changed, or your answer to his question. A sentence or two, plain text.
- patch: only the fields to change; null when he only asked something. Fields: title (100 chars max), description (5000), tags (30 strings), chapters [{"at", "title"}], shorts [{"from", "to", "title"}] (15 to 60 s each), thumbnail {"at", "text"} (text 60 max) or null, and cuts.
- cuts: only the cuts to change, [{"from", "to", "state"}], state "cut" or "kept". One that matches no cut is a new cut. Every other list you give replaces the whole list.
- Every time is seconds on the raw recording, as the transcript gives them.
Write as William: "I", casual, plain words, no em dashes.`;

function legacyVideo(e: VideoEdit, ask: { by: string; message: string }) {
  const now = {
    title: e.title,
    description: e.description,
    tags: e.tags,
    chapters: e.chapters,
    shorts: e.shorts,
    thumbnail: e.thumbnail,
    // Silence cuts are many and his to leave; the rest are the choices.
    cuts: e.cuts.filter((c) => c.why !== "silence"),
    rawSeconds: e.tracks.main.durationS,
  };
  const read = `The transcript, each word with its start and end, and every cut: run \`node scripts/prod-wren.mjs video show ${e.id}\`.`;
  return {
    question: `${ask.by} asks: ${ask.message}`.slice(0, QUESTION_MAX),
    system: `${VIDEO_SYSTEM}\n${read}\n\nThe edit now:\n${JSON.stringify(now)}`.slice(
      0,
      SYSTEM_MAX,
    ),
    commands: [`Bash(node scripts/prod-wren.mjs video show ${e.id})`],
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

describe("Ask Claude prompts as templates", () => {
  it("the draft prompt renders what the code built", () => {
    const items: DraftItem[] = [
      item,
      (({ edits: _, ...rest }) => ({ ...rest, draft: null, guide: "" }))(item),
      { ...item, draft: "", edits: "" },
      { ...item, guide: "x".repeat(9000) },
      { ...item, draft: "y".repeat(5001) },
    ];
    for (const d of items) expect(askPrompt(d, ask)).toEqual(legacyAsk(d, ask));
    expect(draftAskDefault().version).toMatch(/^[0-9a-f]{12}$/);
  });
  it("the video prompt renders what the code built", () => {
    const edit = {
      id: 42,
      title: "A {title}",
      description: "",
      tags: ["a"],
      chapters: [{ at: 0, title: "Intro" }],
      shorts: [],
      thumbnail: null,
      cuts: [
        { from: 1, to: 2, state: "cut", why: "silence" },
        { from: 3, to: 4, state: "kept", why: "filler" },
      ],
      tracks: { main: { durationS: 61.5 } },
    } as unknown as VideoEdit;
    expect(videoPrompt(edit, ask)).toEqual(legacyVideo(edit, ask));
    expect(videoAskDefault().version).toMatch(/^[0-9a-f]{12}$/);
  });
});
