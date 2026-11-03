/**
 * The Ask Claude video prompt moved into the template store must reach Claude byte for byte as
 * the code built it. The legacy builder is that code, kept here verbatim. Synthetic edit only.
 */
import type { VideoEdit } from "@wren/starling-studio/schema";
import { describe, expect, it } from "vitest";
import { videoAskDefault, videoPrompt } from "./video-ask.js";

const QUESTION_MAX = 4000;
const SYSTEM_MAX = 8000;

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
describe("the video ask prompt as a template", () => {
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
