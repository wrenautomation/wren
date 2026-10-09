/** Organic content: posting to each channel, and the plan of what to post. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { defineWorkflow } from "@wren/core/workflows";
import { cutKnobsSchema } from "@wren/studio/cuts";
import { z } from "zod";

/**
 * The client logins posting runs on now (one is enough), and the channels that wait on their apps
 * (designs/2026-10-07-per-client-runs.md): those say "In development".
 */
const CHANNEL_ACCOUNTS = ["linkedin", "reddit"] as const;
const SOON_ACCOUNTS = ["youtube", "linkedin_page", "x", "tiktok", "instagram"] as const;

/** A client's posts and reads: `ContentScheduler/<c>/posts`, `ContentMetrics/<c>/posts`, `SocialWatch/<c>/social`. */
export const POSTS_UNIT = "posts";
export const PLAN_UNIT = "daily";
export const SOCIAL_UNIT = "social";

/** A client's content plan block. `about` is who it posts as: no About, no drafts. */
export const clientPlannerSchema = z.object({
  about: z
    .string()
    .max(500)
    .optional()
    .describe("What the client does and for whom, one line: its posts speak as it"),
  voice: z.string().max(2000).optional().describe("How its posts sound; empty: plain and concise"),
  platforms: z
    .array(z.enum(CHANNEL_ACCOUNTS))
    .optional()
    .describe("Which of its logins to plan for; empty: every one connected"),
  draft: z.boolean().default(true).describe("Fill tomorrow's open slots with drafts"),
});
export type ClientPlannerSettings = z.infer<typeof clientPlannerSchema>;

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
    ready: true,
    requires: { anyAccount: [...CHANNEL_ACCOUNTS] },
    soon: [...SOON_ACCOUNTS],
    provides: {
      services: ["Content", "ContentDesk", "ContentScheduler", "ContentMetrics", "DraftAsk"],
      loops: ["ContentScheduler", "ContentMetrics"],
      templates: ["prompt:content/draft-ask"],
    },
    // A client's approved drafts post on its own login, once an admin turns its posting on.
    clientLoops: (client) => [
      { service: "ContentScheduler", key: clientKey(client, POSTS_UNIT) },
      { service: "ContentMetrics", key: clientKey(client, POSTS_UNIT) },
    ],
    liveSwitch: true,
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
    ready: true,
    settings: clientPlannerSchema,
    requires: { components: ["content.posting"], anyAccount: [...CHANNEL_ACCOUNTS] },
    provides: { services: ["ContentPlanner"], loops: ["ContentPlanner"] },
    // Drafts tomorrow's posts into the client's To approve, as it (its About), on its own models.
    clientLoops: (client) => [{ service: "ContentPlanner", key: clientKey(client, PLAN_UNIT) }],
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
    for: "client",
    ready: true,
    // Wren's own run reads its block from `wren_settings`.
    wrenSettings: true,
    requires: { components: ["content.posting"], anyAccount: [...CHANNEL_ACCOUNTS] },
    // Comments on its posts, its activity and followers, on its own logins, into its database.
    clientLoops: (client) => [{ service: "SocialWatch", key: clientKey(client, SOCIAL_UNIT) }],
    provides: {
      services: ["SocialWatch", "SocialDesk", "InboxDesk", "AutoReply"],
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
    ready: true,
    missing: [],
    // A client's Meta ads wait on its ad account; its ad days stay empty until then.
    soon: ["meta"],
    provides: {
      services: ["MarketingConsole"],
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
        "marketing.link_day",
        "marketing.conversation",
        "marketing.digest",
        "marketing.cadence",
        "marketing.metric",
        "marketing.session",
        "marketing.survey_answer",
        "marketing.heat",
      ],
      apps: ["marketing"],
    },
    hypothesis: {
      from: "Wren's marketing, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Which channels a client has.",
          built: "its posts, drafts and search from its own database (MarketingConsole)",
        },
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
    provides: {
      services: ["VideoDesk"],
      records: ["marketing.video"],
      templates: [
        "prompt:content/video-ask",
        "post:youtube/footer",
        "post:youtube/shorts-footer",
        "post:instagram/reel-footer",
      ],
    },
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
