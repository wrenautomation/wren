/**
 * The social accounts a client connects (designs/2026-10-07-client-social.md): each platform's
 * app, its sign-in, the scopes it asks, what its review gates and what works before it. Pure: the
 * portal page, the worker and the tests read the same table. No imports: the portal's Worker
 * reads it too.
 */

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "x",
  "tiktok",
  "google_business",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** The content channels a connected account posts as: a subset of `@wren/core/content`'s. */
export type SocialChannel = "facebook" | "instagram" | "linkedin" | "youtube" | "x" | "tiktok";

/** Wren's developer apps: one Meta app for a Page and its Instagram, one Google client for both. */
export const SOCIAL_APPS = ["meta", "linkedin", "google", "x", "tiktok"] as const;
export type SocialApp = (typeof SOCIAL_APPS)[number];

/** Each app's name as a person says it, and its key store prefix (`SOCIAL_META_CLIENT_ID`). */
export const APP_NAMES: Record<SocialApp, string> = {
  meta: "Meta",
  linkedin: "LinkedIn",
  google: "Google",
  x: "X",
  tiktok: "TikTok",
};
export const appKey = (app: SocialApp, part: "ID" | "SECRET") =>
  `SOCIAL_${app.toUpperCase()}_CLIENT_${part}`;

export interface SocialSpec {
  label: string;
  app: SocialApp;
  /** The content channel it posts as; null where Wren doesn't post yet (Business Profile). */
  channel: SocialChannel | null;
  authorize: string;
  token: string;
  scopes: readonly string[];
  /** PKCE on the authorize and the exchange. */
  pkce: boolean;
  /** Whether its DMs come into the Inbox and answer from it. */
  dms: boolean;
  /** Whether its comments come into the Inbox. */
  comments: boolean;
  /** What waits on review, said to the client. */
  review: string;
  /** What works before the review passes; null when nothing does (Connect stays off). */
  before: string | null;
  /** Self-serve: what the client does. */
  selfServe: string;
  /** Done for you: what Wren's team does. */
  forYou: string;
}

const META_V = "v23.0";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_read_user_content",
  "pages_manage_engagement",
  "pages_messaging",
  "business_management",
];

export const SOCIAL: Record<SocialPlatform, SocialSpec> = {
  facebook: {
    label: "Facebook Page",
    app: "meta",
    channel: "facebook",
    authorize: `https://www.facebook.com/${META_V}/dialog/oauth`,
    token: `https://graph.facebook.com/${META_V}/oauth/access_token`,
    scopes: META_SCOPES,
    pkce: false,
    dms: true,
    comments: true,
    review: "Meta is reviewing Wren's app.",
    before: "Testers only: Wren's team adds your Page admin as a tester first.",
    selfServe: "Press Connect, sign in to Facebook and pick your Page.",
    forYou:
      "Wren's team adds your Page admin as a tester on its app. Accept the invite, then Connect.",
  },
  instagram: {
    label: "Instagram business",
    app: "meta",
    channel: "instagram",
    authorize: `https://www.facebook.com/${META_V}/dialog/oauth`,
    token: `https://graph.facebook.com/${META_V}/oauth/access_token`,
    scopes: [
      ...META_SCOPES,
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_comments",
      "instagram_manage_messages",
    ],
    pkce: false,
    dms: true,
    comments: true,
    review: "Meta is reviewing Wren's app.",
    before: "Testers only: Wren's team adds your Page admin as a tester first.",
    selfServe:
      "Make the account Business or Creator and link it to your Facebook Page. Then press Connect and pick that Page.",
    forYou: "Wren's team walks you through linking it on a short call.",
  },
  linkedin: {
    label: "LinkedIn",
    app: "linkedin",
    channel: "linkedin",
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "email", "w_member_social"],
    pkce: false,
    dms: false,
    comments: false,
    review: "Company pages wait on LinkedIn's review of Wren's app.",
    before: "Posts as your own profile. Connect again every 60 days.",
    selfServe: "Press Connect and sign in as the person Wren posts as.",
    forYou: "Only that person can sign in. Wren's team helps on a call.",
  },
  youtube: {
    label: "YouTube channel",
    app: "google",
    channel: "youtube",
    authorize: GOOGLE_AUTH,
    token: GOOGLE_TOKEN,
    scopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.force-ssl",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    pkce: true,
    dms: false,
    comments: true,
    review: "Google is verifying Wren's app.",
    before: "Test users only: uploads stay private and the sign-in lasts 7 days.",
    selfServe: "Press Connect and sign in with the Google account that owns the channel.",
    forYou: "Wren's team adds you as a test user first, then you Connect.",
  },
  x: {
    label: "X",
    app: "x",
    channel: "x",
    authorize: "https://x.com/i/oauth2/authorize",
    token: "https://api.x.com/2/oauth2/token",
    scopes: [
      "tweet.read",
      "tweet.write",
      "users.read",
      "offline.access",
      "dm.read",
      "dm.write",
      "media.write",
    ],
    pkce: true,
    dms: true,
    comments: true,
    review: "Nothing to review.",
    before: null,
    selfServe: "Press Connect and authorize Wren.",
    forYou: "Only the account's owner can authorize. Wren's team helps on a call.",
  },
  tiktok: {
    label: "TikTok",
    app: "tiktok",
    channel: "tiktok",
    authorize: "https://www.tiktok.com/v2/auth/authorize/",
    token: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "user.info.stats", "video.publish", "video.upload", "video.list"],
    pkce: false,
    dms: false,
    comments: false,
    review: "TikTok is reviewing Wren's app.",
    before: "Sandbox users only: posts stay private.",
    selfServe: "Press Connect and sign in to TikTok.",
    forYou: "Wren's team adds you to its sandbox first, then you Connect.",
  },
  google_business: {
    label: "Google Business Profile",
    app: "google",
    channel: null,
    authorize: GOOGLE_AUTH,
    token: GOOGLE_TOKEN,
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    pkce: true,
    dms: false,
    comments: false,
    review: "Google is granting Wren's app access to the Business Profile API.",
    before: null,
    selfServe: "Press Connect and sign in as a Profile owner or manager.",
    forYou: "Add Wren's team as a manager on your Profile instead.",
  },
};

/** The platforms that post through a content channel, with that channel. */
export const channelOf = (p: SocialPlatform): SocialChannel | null => SOCIAL[p].channel;

/**
 * Platforms whose review passed, from `WREN_SOCIAL_LIVE` (`facebook,instagram`). X and a LinkedIn
 * profile need none.
 */
export function liveFrom(list: string | null | undefined): ReadonlySet<SocialPlatform> {
  const named = (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SocialPlatform => (SOCIAL_PLATFORMS as readonly string[]).includes(s));
  return new Set<SocialPlatform>(["x", "linkedin", ...named]);
}
