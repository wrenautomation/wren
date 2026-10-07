/** Organic content: posting to each channel, and the plan of what to post. */
import { defineComponent } from "@wren/core/components";
import { defineWorkflow } from "@wren/core/workflows";
import { cutKnobsSchema } from "@wren/studio/cuts";
import { z } from "zod";

const FOR_WREN = "Posts to Wren's own channels, not per client";

export const CONTENT_COMPONENTS = [
  defineComponent({
    id: "content.posting",
    stage: "content",
    channels: ["social"],
    name: "Posting",
    blurb:
      "Posts to YouTube, LinkedIn, Instagram, TikTok, X and Reddit, and reads back the numbers.",
    icon: "play",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    provides: {
      services: ["Content", "ContentDesk", "ContentScheduler", "ContentMetrics", "DraftAsk"],
      loops: ["ContentScheduler", "ContentMetrics"],
    },
    effects: ["posts"],
    in: [{ id: "drafts", label: "drafts", kind: "post" }],
    out: [{ id: "posts", label: "posts", kind: "post" }],
    hypothesis: {
      from: "Wren's own channels, 2026-09",
      guesses: [
        { is: "change", says: "Which channels, per client.", built: null },
        { is: "needs", says: "The client's own account on each channel.", built: null },
        {
          is: "fixed",
          says: "Every post goes through one site layer, which reads the numbers back too.",
        },
      ],
    },
  }),
  defineComponent({
    id: "content.planner",
    stage: "content",
    channels: ["social"],
    name: "Content plan",
    blurb: "Plans each day's posts per channel.",
    icon: "board",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["content.posting"] },
    provides: { services: ["ContentPlanner"], loops: ["ContentPlanner"] },
    effects: ["spends"],
    out: [{ id: "drafts", label: "drafts", kind: "post" }],
    hypothesis: {
      from: "Wren's daily plan, 2026-09",
      guesses: [
        { is: "change", says: "How often to post on each channel.", built: null },
        { is: "change", says: "Topics drawn from the client's offers and playbooks.", built: null },
        { is: "fixed", says: "One plan a day per channel." },
      ],
    },
  }),
  defineComponent({
    id: "content.social",
    stage: "content",
    channels: ["social"],
    name: "Social inbox",
    blurb:
      "Reads comments on our posts, follows, mentions and follower counts every 30 minutes into Marketing → Inbox.",
    icon: "people",
    for: "wren",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["content.posting"] },
    provides: {
      services: ["SocialWatch", "SocialDesk"],
      loops: ["SocialWatch"],
      records: [
        "marketing.inbox",
        "marketing.approval",
        "marketing.activity",
        "marketing.audience",
      ],
    },
    out: [{ id: "comment", label: "new comments", kind: "comment" }],
    hypothesis: {
      from: "designs/2026-10-06-social-inbox.md",
      guesses: [
        { is: "change", says: "Which platforms.", built: "the WREN_CONTENT_CHANNELS setting" },
        {
          is: "change",
          says: "How often: 30 minutes, posts past 3 days and LinkedIn activity every 2 hours.",
          built: "SOCIAL_EVERY_MS, SLOW_EVERY_MS, ACTIVITY_EVERY_MS",
        },
        { is: "fixed", says: "It reads only; every answer waits on William's click." },
      ],
    },
  }),
  /** The Marketing app's numbers: content, ads, search, texts and the site, read only. */
  defineComponent({
    id: "marketing.stats",
    stage: "content",
    name: "Marketing numbers",
    blurb: "Every post, ad set, search page, text and site visit as one funnel.",
    icon: "chart",
    for: "client",
    ready: false,
    missing: ["Not ready until a client runs content"],
    provides: {
      records: [
        "marketing.draft",
        "marketing.post",
        "marketing.ad_day",
        "marketing.search_page",
        "marketing.keyword",
        "marketing.search_day",
        "marketing.answer",
        "marketing.text_contact",
        "marketing.dm",
        "marketing.dm_copy",
        "marketing.text_copy",
        "marketing.site_day",
        "marketing.funnel",
        "marketing.session",
        "marketing.survey_answer",
        "marketing.heat",
      ],
      apps: ["marketing"],
    },
    hypothesis: {
      from: "Wren's marketing, 2026-09",
      guesses: [
        { is: "change", says: "Which channels a client has.", built: null },
        { is: "fixed", says: "Every channel lands in one funnel, counted the same way." },
      ],
    },
  }),
  /** `packages/studio`: the editor runs on William's Mac; the page and its desk run here. */
  defineComponent({
    // `wren_settings.studio`, read by `cutKnobs` in @wren/studio/edit.
    id: "studio",
    stage: "content",
    channels: ["social"],
    name: "Video editor",
    blurb:
      "Cuts silences from a recording, adds captions, Shorts and a thumbnail, and uploads to YouTube once approved.",
    icon: "play",
    for: "wren",
    ready: false,
    missing: ["Edits William's own recordings on his Mac; never a client's"],
    settings: z.object({ cuts: cutKnobsSchema.default(cutKnobsSchema.parse({})) }),
    requires: { components: ["content.posting"] },
    provides: { services: ["VideoDesk"], records: ["marketing.video"] },
    effects: ["posts"],
    out: [
      {
        id: "videos",
        label: "videos",
        kind: "post",
        count: { record: "marketing.video", view: "all" },
      },
    ],
    hypothesis: {
      from: "designs/2026-10-06-video-editor.md",
      guesses: [
        {
          is: "change",
          says: "How tight the silence cuts are, per voice and room.",
          built: "settings.cuts",
        },
        {
          is: "change",
          says: "Where a cut goes: YouTube now, Shorts and Reels next.",
          built: null,
        },
        { is: "fixed", says: "Every upload waits on a yes and goes up private." },
      ],
    },
  }),
];

export const CONTENT_WORKFLOWS = [
  defineWorkflow({
    id: "content",
    stage: "content",
    name: "Organic content",
    blurb: "Plans each day's posts, posts them on every channel and reads the numbers back.",
    icon: "play",
    for: "client",
    nodes: [
      { id: "planner", uses: "content.planner" },
      { id: "posting", uses: "content.posting" },
    ],
    wires: [{ from: "planner.drafts", to: "posting.drafts", via: "code" }],
  }),
];
