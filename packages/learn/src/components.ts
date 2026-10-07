/** Learn (designs/2026-10-07-learn.md): saved links and feed items, read, scored, kept. */
import { defineComponent } from "@wren/core/components";
import { defineWorkflow } from "@wren/core/workflows";

const OWN = "A client's Learn has no alerts outside the portal: no push or digest yet";
const from = "William's ask, 2026-10-07";

export const LEARN_COMPONENTS = [
  defineComponent({
    id: "learn.save",
    stage: "run",
    channels: ["web"],
    name: "Saved links",
    blurb: "Takes any link William shares in: from the portal, his phone's share sheet or the CLI.",
    icon: "pin",
    for: "wren",
    ready: false,
    missing: [OWN],
    provides: { services: ["LearnConsole"], records: ["learn.saved"], apps: ["learn"] },
    out: [{ id: "item", label: "saved items", kind: "item" }],
    hypothesis: {
      from,
      guesses: [
        { is: "fixed", says: "The same link twice is one item." },
        { is: "fixed", says: "Nothing signs in to his Instagram or TikTok." },
      ],
    },
  }),
  defineComponent({
    id: "learn.read",
    stage: "run",
    channels: ["web"],
    name: "Reader",
    blurb:
      "Keeps each item's words: an article's text here, a video's speech and screen on the Mac.",
    icon: "play",
    for: "wren",
    ready: false,
    missing: [OWN],
    in: [{ id: "item", label: "items", kind: "item" }],
    out: [{ id: "read", label: "read items", kind: "item" }],
    hypothesis: {
      from,
      guesses: [
        {
          is: "needs",
          says: "Videos and reels: yt-dlp and the Gemini keys, on the Mac.",
          built: "wren learn read",
        },
        { is: "fixed", says: "Transcripts are kept in the database, whole." },
      ],
    },
  }),
  defineComponent({
    id: "learn.score",
    stage: "run",
    channels: ["web"],
    name: "Learn scoring",
    blurb:
      "Scores each read item 0 to 10 on how much it should change how Wren works, against its SOPs.",
    icon: "search",
    for: "wren",
    ready: false,
    missing: [OWN],
    requires: { components: ["learn.read"] },
    effects: ["spends"],
    provides: { records: ["learn.item", "learn.source", "learn.sop"] },
    in: [{ id: "item", label: "read items", kind: "item" }],
    out: [
      { id: "show", label: "worth reading", kind: "item" },
      { id: "hold", label: "worth knowing", kind: "item" },
      { id: "drop", label: "dropped", kind: "item" },
    ],
    hypothesis: {
      from,
      guesses: [
        { is: "change", says: "Which sources.", built: "learn.sources, from Learn → Sources" },
        {
          is: "change",
          says: "What it scores against: the SOPs pushed with wren sop push.",
          built: "content_playbooks, from wren sop push",
        },
        { is: "needs", says: "A model; Cohere by default.", built: "env WREN_WATCH_LLM" },
        { is: "fixed", says: "7 and up shows, 4 to 6 holds, the rest drops." },
        {
          is: "fixed",
          says: "A client's items score on its own models allowance, against its own SOPs.",
        },
        { is: "fixed", says: "Following a source scores what comes next, not its back catalog." },
      ],
    },
  }),
];

export const LEARN_WORKFLOWS = [
  defineWorkflow({
    id: "learn",
    stage: "run",
    name: "Learn",
    blurb:
      "Reads what William saves and what the sources he follows publish, and scores each against how Wren works.",
    icon: "play",
    for: "wren",
    out: [{ id: "to_read", label: "worth reading", kind: "item" }],
    nodes: [
      { id: "feeds", uses: "watch.read" },
      { id: "saved", uses: "learn.save" },
      { id: "read", uses: "learn.read" },
      { id: "score", uses: "learn.score" },
    ],
    wires: [
      { from: "feeds.items", to: "read.item", via: "events" },
      { from: "saved.item", to: "read.item", via: "events" },
      { from: "read.read", to: "score.item", via: "events" },
      { from: "score.show", to: "out.to_read", via: "events" },
    ],
  }),
];
