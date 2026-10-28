/** Each platform's comments settings block (`<platform>.comments`), its limits and defaults. */

import { settingsFor } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { z } from "zod";
import { REACH_POST_PLATFORMS, type ReachPostPlatform } from "../schema.js";

/** Each platform's settings block. */
export const COMMENTS_COMPONENTS: Readonly<Record<ReachPostPlatform, string>> = {
  linkedin: "linkedin.comments",
  x: "x.comments",
  instagram: "instagram.comments",
  youtube: "youtube.comments",
  tiktok: "tiktok.comments",
  threads: "threads.comments",
};
export const PLATFORM_NAME: Readonly<Record<ReachPostPlatform, string>> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  threads: "Threads",
};
/**
 * The credential each platform's login is under: Threads signs in through Instagram, so its
 * reads and acts run on the instagram site as an Instagram login. YouTube signs in with Google:
 * its token is kept for the Google login (`google@wren`); a plain `youtube` holds none.
 */
const LOGIN_SITE: Readonly<Record<ReachPostPlatform, string>> = {
  linkedin: "linkedin",
  x: "x",
  instagram: "instagram",
  youtube: "google",
  tiktok: "tiktok",
  threads: "instagram",
};
/** The longest comment each platform takes (X: a reply from a Basic account). */
export const COMMENT_MAX: Readonly<Record<ReachPostPlatform, number>> = {
  linkedin: 1250,
  x: 280,
  instagram: 2200,
  youtube: 1000,
  tiktok: 150,
  threads: 500,
};
/** How long the model may write, in its words. */
export const COMMENT_LENGTH: Readonly<Record<ReachPostPlatform, string>> = {
  linkedin: "At most 3 sentences, under 600 characters.",
  x: "One or two sentences, under 250 characters.",
  instagram: "One or two sentences, under 300 characters.",
  youtube: "One or two sentences, under 300 characters.",
  tiktok: "One sentence, under 140 characters.",
  threads: "One or two sentences, under 300 characters.",
};

/** The rank a post needs for a draft, unless the settings say otherwise. */
export const MIN_FIT = 70;
/**
 * Wren's buyers: any business past the smallest, in any niche (William, 10-26). Word starts, so
 * "compan" meets "company" and "companies".
 */
export const DEFAULT_AUDIENCE = [
  "business",
  "compan",
  "firm",
  "agency",
  "founder",
  "owner",
  "ceo",
  "b2b",
  "startup",
  "client",
  "customer",
] as const;
/** Who Wren's buyers are, in plain words: the model writes search words from it. */
const DEFAULT_ABOUT =
  "Owners, founders and leaders of established businesses with ten or more people, in any industry. In their own posts they talk about winning clients, sales, growth, hiring, and running the company.";
/** Search words the model adds a pass, unless the settings say otherwise. */
const NEW_TOPICS = 3;
/** Logins that never read or comment here: his own LinkedIn profile and the research alt. */
const NEVER: Readonly<Record<ReachPostPlatform, readonly string[]>> = {
  linkedin: ["linkedin", "linkedin@alt"],
  x: [],
  instagram: [],
  youtube: [],
  tiktok: [],
  threads: [],
};

/** How fast a post's comment window fades, by platform: a feed's pace, not a fixed cutoff. */
const HALF_LIFE_HOURS: Readonly<Record<ReachPostPlatform, number>> = {
  x: 8,
  threads: 12,
  instagram: 24,
  linkedin: 36,
  tiktok: 168,
  youtube: 720,
};

/** One platform's settings; all three share the shape. */
function commentsSettingsSchemaFor(platform: ReachPostPlatform) {
  return z
    .object({
      /** The autobrowse login that reads, likes and follows (`linkedin@wren`, `x@wren`); empty = off. */
      account: z
        .string()
        .trim()
        .default("")
        .refine(
          (a) => !NEVER[platform].includes(a),
          "never his personal LinkedIn or the research alt",
        )
        .refine(
          (a) =>
            !a ||
            a.startsWith(`${LOGIN_SITE[platform]}@`) ||
            (platform !== "linkedin" && platform !== "youtube" && a === LOGIN_SITE[platform]),
          `a ${LOGIN_SITE[platform]} login: ${LOGIN_SITE[platform]}@<label>`,
        ),
      /** Comments drafted a day, at most; autobrowse's comment cap bounds the sends. */
      perDay: z.number().int().min(0).max(40).default(10),
      /**
       * Drafts go out on the scheduler's spaced slots without his click (`pacing.ts`). On by
       * default: quality drop accepted while he builds the full system (William, 10-26).
       */
      autoSend: z.boolean().default(true),
      /** Words to search posts for ("recruiting agency"); one read each. */
      topics: z.array(z.string().trim().min(1)).default([]),
      /**
       * Accounts he follows, read first each pass and ranked as key people: LinkedIn company
       * handles or `in/<vanity>` for a person, X or Instagram usernames.
       */
      pages: z.array(z.string().trim().min(1)).default([]),
      /** Also read posts by people we know: people we invited, people who engaged with us. */
      people: z.boolean().default(true),
      /** LinkedIn search only: keep authors whose title has these words ("founder"). */
      authorTitle: z.string().trim().max(100).default(""),
      /** A fit post is liked and its author followed with no yes, and again with his Comment. */
      like: z.boolean().default(true),
      follow: z.boolean().default(true),
      /**
       * Hours a post's timing points take to halve (`momentum`). A late comment on a post still
       * gathering is worth more than an early one on a dead post: X fades in hours, YouTube in months.
       */
      halfLifeHours: z.number().int().min(1).max(4380).default(HALF_LIFE_HOURS[platform]),
      /** The guard: posts older than this are left whatever their pace. Four half-lives by default. */
      maxAgeHours: z
        .number()
        .int()
        .min(6)
        .max(8760)
        .default(4 * HALF_LIFE_HOURS[platform]),
      /** Code's rank (0 to 100) a post needs before a comment is drafted for it. */
      minFit: z.number().int().min(0).max(100).default(MIN_FIT),
      /**
       * Words that put a post in the audience's world, matched as word starts ("recruit" meets
       * "recruiters"). A post with none is dropped as off target.
       */
      audience: z.array(z.string().trim().min(2)).default([...DEFAULT_AUDIENCE]),
      /** Who the buyers are, in plain words; the model writes new search words from it. */
      about: z.string().trim().min(1).default(DEFAULT_ABOUT),
      /** Search words the model adds each pass from `about` and past yields; 0 = only `topics`. */
      newTopics: z.number().int().min(0).max(6).default(NEW_TOPICS),
    })
    .strict();
}
export const COMMENTS_SETTINGS = Object.fromEntries(
  REACH_POST_PLATFORMS.map((p) => [p, commentsSettingsSchemaFor(p)]),
) as Record<ReachPostPlatform, ReturnType<typeof commentsSettingsSchemaFor>>;
export type CommentsSettings = z.infer<ReturnType<typeof commentsSettingsSchemaFor>>;

/** Wren's block for one platform (Shop → comments); a bad one reads as off. */
export async function commentsSettings(
  db: Queryable,
  platform: ReachPostPlatform,
): Promise<CommentsSettings> {
  const schema = COMMENTS_SETTINGS[platform];
  const got = schema.safeParse((await settingsFor(db, null))[COMMENTS_COMPONENTS[platform]]);
  return got.success ? got.data : schema.parse({});
}

/** Every platform's block. */
export async function allCommentsSettings(
  db: Queryable,
): Promise<Record<ReachPostPlatform, CommentsSettings>> {
  const all = await settingsFor(db, null);
  return Object.fromEntries(
    REACH_POST_PLATFORMS.map((p) => {
      const got = COMMENTS_SETTINGS[p].safeParse(all[COMMENTS_COMPONENTS[p]]);
      return [p, got.success ? got.data : COMMENTS_SETTINGS[p].parse({})];
    }),
  ) as Record<ReachPostPlatform, CommentsSettings>;
}
