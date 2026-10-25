/**
 * Ads → Formats (designs/2026-10-11-ad-formats.md): the creative shapes we make ads in. The list
 * starts from `AD_FORMAT_SEED` (migration 0229 writes it once); after that it is ours to edit, and
 * every save goes through the records layer, so `changes` keeps who changed what.
 */
import { cued, date, defineRecord, money, number, prose, status, text } from "@wren/core/records";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AD_FORMAT_FAMILIES, AD_FORMAT_STATES, type AdFormatFamily, adFormats } from "../schema.js";

interface AdFormatSeed {
  slug: string;
  name: string;
  family: AdFormatFamily;
  what: string;
  use: string;
}

/** The 42 from the reel (instagram.com/reel/Db8pB-BIkH6), each said for an offer like ours: a service sold to a business. */
export const AD_FORMAT_SEED: readonly AdFormatSeed[] = (
  [
    [
      "breaking-news",
      "Breaking news",
      "alarm",
      "A news banner announcing the offer or a change.",
      "A launch, a new service, a price change.",
    ],
    [
      "trustpilot-reviews",
      "Review stars",
      "proof",
      "Real review cards with stars around one claim.",
      "Once there are reviews to show; warm and retargeting.",
    ],
    [
      "offer",
      "Offer",
      "offer",
      "The offer and its terms, big, nothing else.",
      "Retargeting people who already know us.",
    ],
    [
      "script",
      "Script",
      "lesson",
      "The exact words to say in a situation, on screen.",
      "Owners who write or call their own customers.",
    ],
    [
      "whiteboard",
      "Whiteboard",
      "lesson",
      "A hand drawing the problem and the fix on a board.",
      "Explaining how the system works, cold.",
    ],
    [
      "us-vs-them",
      "Us vs them",
      "contrast",
      "Two columns: us against the usual choice.",
      "When the usual choice is an agency or a hire.",
    ],
    [
      "ai-podcast",
      "AI podcast",
      "story",
      "Two voices talking through the problem like a podcast clip.",
      "Cold, for an idea that needs a minute.",
    ],
    [
      "doodle",
      "Doodle",
      "lesson",
      "Simple drawings telling the before and after.",
      "Cold, a light way into a dry topic.",
    ],
    [
      "low-stock-alert",
      "Low stock",
      "alarm",
      "Few left: slots, seats or days.",
      "Real limits only: onboarding slots this month.",
    ],
    [
      "myth-vs-fact",
      "Myth vs fact",
      "contrast",
      "A belief people hold, then what's true.",
      "Cold, against a wrong idea about the work.",
    ],
    [
      "iphone-notes",
      "Phone notes",
      "native",
      "A list typed in the Notes app.",
      "A checklist or steps; looks like a person wrote it.",
    ],
    [
      "transformation",
      "Transformation",
      "proof",
      "Before and after, side by side.",
      "A client's numbers or pipeline, before and after.",
    ],
    [
      "zero-stars",
      "Zero stars",
      "humor",
      "A fake bad review that is praise: 'ruined my weekends, too many calls'.",
      "Cold; needs a clear joke.",
    ],
    [
      "google-search",
      "Google search",
      "native",
      "A search box with the question the buyer types.",
      "When buyers search the problem by name.",
    ],
    [
      "bundle",
      "Bundle",
      "offer",
      "What's included, stacked, with the price.",
      "Packages with several parts.",
    ],
    [
      "dont-be-an-idiot",
      "Don't be an idiot",
      "humor",
      "A blunt mistake list, said with a grin.",
      "Cold, to owners who know the mistake.",
    ],
    [
      "reddit-style",
      "Reddit post",
      "native",
      "A forum post with replies talking about the result.",
      "Cold; reads as a peer, not an ad.",
    ],
    [
      "side-effects",
      "Side effects",
      "humor",
      "Side effects of using it: 'more calls, less admin'.",
      "Cold or warm; benefits as a joke list.",
    ],
    [
      "were-sorry",
      "We're sorry",
      "story",
      "An apology: sold out, late, too good.",
      "Warm; after a full month or a fix.",
    ],
    [
      "tier-list",
      "Tier list",
      "lesson",
      "Options ranked S to D.",
      "Cold, comparing tools or channels the buyer knows.",
    ],
    [
      "instagram-story",
      "Story",
      "native",
      "Looks like a plain Instagram story, sticker and all.",
      "Placements in Stories and Reels.",
    ],
    [
      "x-signs",
      "X signs",
      "lesson",
      "'3 signs your follow-up is losing leads'.",
      "Cold, self-diagnosis.",
    ],
    [
      "problem-vs-solution",
      "Problem vs solution",
      "contrast",
      "The problem in one line, the fix in the next.",
      "Cold, one sharp pain.",
    ],
    [
      "warning",
      "Warning",
      "alarm",
      "A warning sign around a costly mistake.",
      "Cold, a mistake with a cost.",
    ],
    [
      "claymation",
      "Claymation",
      "story",
      "Clay or 3D figures acting it out.",
      "Cold, to stop the scroll; costly to make.",
    ],
    [
      "you-can-avoid",
      "You can avoid",
      "lesson",
      "A pain they don't have to keep.",
      "Cold, one avoidable chore.",
    ],
    [
      "reasons-why",
      "Reasons why",
      "lesson",
      "A numbered list of reasons to act.",
      "Warm, closing reasons.",
    ],
    [
      "email-screenshot",
      "Email screenshot",
      "native",
      "A screenshot of an email: a reply, a booking.",
      "Proof that the outreach gets answers.",
    ],
    [
      "text-message",
      "Text message",
      "native",
      "A text thread, someone telling a friend.",
      "Word of mouth; a client telling another owner.",
    ],
    [
      "crossed-out-problems",
      "Crossed-out problems",
      "contrast",
      "A list of problems, each struck through.",
      "Cold, several small pains at once.",
    ],
    [
      "native",
      "Native",
      "native",
      "The product in an everyday scene, no ad look.",
      "Feeds where polish reads as an ad.",
    ],
    [
      "hack-101",
      "Hack 101",
      "lesson",
      "One tip they can use today.",
      "Cold; gives first, asks later.",
    ],
    [
      "emergency",
      "Emergency",
      "alarm",
      "'In case of emergency, break glass.'",
      "Seasonal rushes, a slow month.",
    ],
    [
      "testimonial",
      "Testimonial",
      "proof",
      "A client's words and face.",
      "Warm and cold once there are clients to quote.",
    ],
    [
      "greenscreen",
      "Greenscreen",
      "story",
      "A person talking in front of a screenshot or headline.",
      "Reacting to news, a post, a result.",
    ],
    [
      "dont-buy-this",
      "Don't buy this",
      "humor",
      "'Don't buy this unless you want…'",
      "Cold, a reverse pitch.",
    ],
    [
      "stat-headline",
      "Stat headline",
      "proof",
      "One sourced number, big.",
      "Cold, when the stat is sharp and sourced.",
    ],
    [
      "meme",
      "Meme",
      "humor",
      "A known meme reworded for the buyer.",
      "Cold, young or online owners.",
    ],
    [
      "new-vs-old",
      "New vs old",
      "contrast",
      "The old way beside the new way.",
      "Cold, against the way they do it now.",
    ],
    [
      "text-on-skin",
      "Text on skin",
      "story",
      "Words written on a hand or arm.",
      "Cold; odd enough to stop a scroll.",
    ],
    [
      "us-vs-us",
      "Us vs us",
      "contrast",
      "Our old version against our new one.",
      "Warm, a new release or price.",
    ],
    [
      "venn",
      "Venn",
      "lesson",
      "Two circles; we sit where they meet.",
      "Cold, positioning in one picture.",
    ],
  ] as const satisfies readonly (readonly [string, string, AdFormatFamily, string, string])[]
).map(([slug, name, family, what, use]) => ({
  slug,
  name,
  family,
  what,
  use,
}));

const neutral = (label: string) => ({ label, tone: "neutral" as const });

const FAMILY_LABELS = cued({
  offer: neutral("Offer"),
  proof: neutral("Proof"),
  contrast: neutral("Contrast"),
  story: neutral("Story"),
  native: neutral("Native look"),
  alarm: neutral("Alarm"),
  lesson: neutral("Lesson"),
  humor: neutral("Humor"),
});

const STATE_LABELS = {
  idea: neutral("Idea"),
  testing: { label: "Testing", tone: "warn" as const },
  proven: { label: "Proven", tone: "good" as const },
  retired: { label: "Retired", tone: "bad" as const },
};

const EDITED = ["name", "family", "state", "what", "use", "notes"] as const;

export const adFormatRecord = defineRecord({
  id: "ads.format",
  app: "marketing",
  channel: null,
  name: { one: "format", many: "formats" },
  view: "ad_format_records",
  key: "id",
  title: "name",
  subtitle: "what",
  fields: {
    name: text("Format"),
    family: status(FAMILY_LABELS, "Leans on"),
    state: status(STATE_LABELS, "State"),
    what: prose("Looks like"),
    use: prose("Fits"),
    notes: prose("Notes", { listed: false }),
    launches: number("Launches"),
    spend: money("Spend"),
    impressions: number("Shown", { listed: false }),
    clicks: number("Clicks", { listed: false }),
    ctr: number("CTR %"),
    leads: number("Leads"),
    costPerLead: money("Per lead"),
    source: text("Found at", { listed: false }),
    updatedAt: date("Saved", { listed: false }),
    updatedBy: text("By", { listed: false }),
  },
  quick: ["family", "state"],
  views: [
    { id: "all", label: "All", where: { state: ["idea", "testing", "proven"] }, sort: "name" },
    { id: "proven", label: "Proven", where: { state: ["proven"] }, sort: "-leads" },
    { id: "testing", label: "Testing", where: { state: ["testing"] }, sort: "-spend" },
    { id: "ideas", label: "Ideas", where: { state: ["idea"] }, sort: "name" },
    { id: "retired", label: "Retired", where: { state: ["retired"] }, sort: "name" },
  ],
  edits: {
    fields: EDITED,
    patch: z
      .object({
        name: z.string().trim().min(1).max(80),
        family: z.enum(AD_FORMAT_FAMILIES),
        state: z.enum(AD_FORMAT_STATES),
        what: z.string().trim().min(1).max(400),
        use: z.string().trim().min(1).max(400),
        notes: z.string().max(4000),
      })
      .partial()
      .strict(),
    about: "an ad format: what the ad looks like, when it fits us, and what we learned running it",
    read: async (db, id) => {
      const [f] = await db.select().from(adFormats).where(eq(adFormats.slug, id));
      return f
        ? Object.fromEntries(EDITED.map((k) => [k, k === "notes" ? (f.notes ?? "") : f[k]]))
        : null;
    },
    write: async (db, id, patch, by) => {
      await db
        .update(adFormats)
        .set({ ...patch, updatedAt: sql`now()`, updatedBy: by })
        .where(eq(adFormats.slug, id));
    },
    context: async () =>
      [
        "Wren sells a service to businesses. A format is the shape of an ad,",
        "not its words. Proven needs numbers from its launches; say why in notes.",
      ].join(" "),
  },
});
