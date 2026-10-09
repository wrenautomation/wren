/**
 * TikTok's Direct Post rules (developers.tiktok.com/doc/content-sharing-guidelines), in one place
 * for the post's shape, the portal's form, the approve check and the adapter: the creator as
 * `creator_info/query` answers it, the words TikTok requires, and why a post can't go yet.
 */

/** Who can see a post, as TikTok names them. The creator's own options are a subset. */
export const TIKTOK_PRIVACY = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];
export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export const TIKTOK_MUSIC_URL =
  "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const TIKTOK_BC_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

/** TikTok's required words, as its guidelines give them. */
export const TIKTOK_COPY = {
  disclose: "Disclose post content",
  discloseHint: "Indicate whether this content promotes yourself, a brand, product or service.",
  yourBrand: "Your brand",
  yourBrandHint:
    "You are promoting yourself or your own business. This content will be classified as Brand Organic.",
  brandedContent: "Branded content",
  brandedContentHint:
    "You are promoting another brand or a third party. This content will be classified as Branded Content.",
  promotional: "Your photo/video will be labeled as 'Promotional content'",
  paid: "Your photo/video will be labeled as 'Paid partnership'",
  pickOne: "You need to indicate if your content promotes yourself, a third party, or both.",
  brandedPrivate: "Branded content visibility cannot be set to private.",
  processing:
    "After it posts, it may take a few minutes for TikTok to process it and show it on the profile.",
  tryLater: "TikTok says this account can't post more right now. Try again later.",
} as const;

/** The declaration above the yes, by what the disclosure says, its links in order. */
export function tiktokDeclaration(f: TikTokChoices): {
  text: string;
  links: { label: string; url: string }[];
} {
  const music = { label: "Music Usage Confirmation", url: TIKTOK_MUSIC_URL };
  if (f.disclose && f.brandedContent)
    return {
      text: "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.",
      links: [{ label: "Branded Content Policy", url: TIKTOK_BC_URL }, music],
    };
  return { text: "By posting, you agree to TikTok's Music Usage Confirmation.", links: [music] };
}

/** The label TikTok puts on the post, by the disclosure; null without one. */
export function tiktokLabel(f: TikTokChoices): string | null {
  if (!f.disclose) return null;
  if (f.brandedContent) return TIKTOK_COPY.paid;
  if (f.yourBrand) return TIKTOK_COPY.promotional;
  return null;
}

/** The choices on a post that TikTok's rules read. */
export interface TikTokChoices {
  privacy?: string | undefined;
  allowComment?: boolean | undefined;
  allowDuet?: boolean | undefined;
  allowStitch?: boolean | undefined;
  disclose?: boolean | undefined;
  yourBrand?: boolean | undefined;
  brandedContent?: boolean | undefined;
}

/** Why the choices break a rule whatever the creator: branded content can't be private. */
export function tiktokBroken(f: TikTokChoices): string | null {
  return f.disclose && f.brandedContent && f.privacy === "SELF_ONLY"
    ? TIKTOK_COPY.brandedPrivate
    : null;
}

/** What a person must still pick before the yes: who can see it, and a disclosure that's on. */
export function tiktokMissing(f: TikTokChoices): string[] {
  return [
    ...(f.privacy ? [] : ["Who can see it"]),
    ...(f.disclose && !f.yourBrand && !f.brandedContent ? [TIKTOK_COPY.pickOne] : []),
  ];
}

/** The creator as `/v2/post/publish/creator_info/query/` answers, read right before a post. */
export interface TikTokCreator {
  nickname: string;
  username: string | null;
  avatarUrl: string | null;
  privacyOptions: TikTokPrivacy[];
  commentOff: boolean;
  duetOff: boolean;
  stitchOff: boolean;
  /** The longest video this creator may post, in seconds; null when TikTok gave none. */
  maxVideoSec: number | null;
  /** False when TikTok says the account can't post now (`spam_risk_*`, the active-user cap). */
  canPost: boolean;
  /** TikTok's code when it can't post. */
  why: string | null;
}

/** The answer's codes that mean "not now": TikTok sends them with a 200. */
const CANT_POST = new Set([
  "spam_risk_too_many_posts",
  "spam_risk_user_banned_from_posting",
  "reached_active_user_cap",
]);

/** The creator from TikTok's answer; a code that isn't `ok` and isn't "not now" throws. */
export function creatorFrom(answer: unknown): TikTokCreator {
  const a = (answer ?? {}) as { data?: Record<string, unknown>; error?: { code?: unknown } };
  const code = typeof a.error?.code === "string" ? a.error.code : "ok";
  if (code !== "ok" && !CANT_POST.has(code)) throw new Error(`tiktok: creator info said ${code}`);
  const d = a.data ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const options = Array.isArray(d.privacy_level_options)
    ? (d.privacy_level_options as unknown[]).filter((o): o is TikTokPrivacy =>
        (TIKTOK_PRIVACY as readonly unknown[]).includes(o),
      )
    : [];
  const max = Number(d.max_video_post_duration_sec);
  return {
    nickname: str(d.creator_nickname) ?? str(d.creator_username) ?? "Your TikTok account",
    username: str(d.creator_username),
    avatarUrl: str(d.creator_avatar_url),
    privacyOptions: options,
    commentOff: d.comment_disabled === true,
    duetOff: d.duet_disabled === true,
    stitchOff: d.stitch_disabled === true,
    maxVideoSec: Number.isFinite(max) && max > 0 ? max : null,
    canPost: code === "ok",
    why: code === "ok" ? null : code,
  };
}

/**
 * Why this post can't go to this creator now, or null: the account can't post, the pick isn't one
 * of its options, the video runs past its limit, or a rule above.
 */
export function tiktokHold(
  f: TikTokChoices,
  c: TikTokCreator,
  videoSec?: number | null,
): string | null {
  if (!c.canPost) return TIKTOK_COPY.tryLater;
  const missing = tiktokMissing(f);
  if (missing.length) return `Pick first: ${missing.join("; ")}`;
  if (!c.privacyOptions.includes(f.privacy as TikTokPrivacy))
    return `This account can't post as ${TIKTOK_PRIVACY_LABELS[f.privacy as TikTokPrivacy] ?? f.privacy}. Pick who can see it again.`;
  const broken = tiktokBroken(f);
  if (broken) return broken;
  if (videoSec && c.maxVideoSec && videoSec > c.maxVideoSec)
    return `The video is ${Math.ceil(videoSec)} seconds; this account posts up to ${c.maxVideoSec}.`;
  return null;
}
