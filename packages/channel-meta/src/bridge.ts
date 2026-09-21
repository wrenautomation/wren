/**
 * The two ways ads and organic content feed each other, as pure functions:
 * a winning ad becomes an idea for a post (AdsWatch adds it, nobody drafts
 * it until the person says), and a published post becomes a launch spec
 * (PAUSED, printed, nothing spends).
 */
import type { LaunchSpec } from "./ads.js";
import type { Verdict } from "./launches.js";

/** Worth telling the content loop about: a result, or ten clicks. */
export const isWinner = (v: Verdict): boolean =>
  v.pause === null && (v.result.results > 0 || v.result.clicks >= 10);

/** The idea text: the numbers and the message that earned them. */
export function ideaFromVerdict(v: Verdict): string {
  const r = v.result;
  const message = v.launch.spec.creative.message.trim();
  return [
    `the ad "${v.launch.name}" got ${r.clicks} clicks and ${r.results} results on $${r.spendUsd.toFixed(2)} in 7 days.`,
    `the message that did it:`,
    message,
    `make a post out of what worked.`,
  ].join("\n");
}

export interface PostLike {
  text: string;
  title?: string | null;
  url?: string | null;
  media?: { kind: "image" | "video"; source: string; title?: string } | null;
}

export interface SpecFromPostOptions {
  /** Where the ad sends people; default the post's own URL. */
  link?: string;
  dailyBudgetUsd?: number;
  countries?: string[];
  headline?: string;
}

const firstLine = (text: string): string => text.split(/\r?\n/).find((l) => l.trim()) ?? text;

/** A launch spec from a post that worked: same words, same media, PAUSED. */
export function specFromPost(post: PostLike, o: SpecFromPostOptions = {}): LaunchSpec {
  const link = o.link ?? post.url ?? null;
  if (!link) throw new Error("spec needs a link: the post has no URL, give --link");
  const head = (post.title ?? firstLine(post.text)).trim().slice(0, 60);
  const media = post.media;
  return {
    name: `post · ${head}`,
    objective: "OUTCOME_TRAFFIC",
    dailyBudgetUsd: o.dailyBudgetUsd ?? 10,
    targeting: { countries: o.countries?.length ? o.countries : ["US"] },
    optimizationGoal: "LINK_CLICKS",
    creative: {
      message: post.text.trim(),
      link,
      headline: o.headline ?? head,
      callToAction: "LEARN_MORE",
      ...(media ? { media: { kind: media.kind, source: media.source } } : {}),
    },
    status: "PAUSED",
  };
}
