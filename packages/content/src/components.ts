/** Organic content: posting to each channel, and the plan of what to post. */
import { defineComponent } from "@wren/core/components";
import { defineWorkflow } from "@wren/core/workflows";

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
      services: ["Content", "ContentDesk", "ContentScheduler", "ContentMetrics"],
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
