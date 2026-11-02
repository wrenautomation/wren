/** Code's rank of a post: the audience's world, growth, who wrote it, timing; job ads are off. */

import type { FeedPost } from "./read.js";
import { DEFAULT_AUDIENCE } from "./settings.js";

const HOUR = 3_600_000;

/** The most points `momentum` gives: as many as the fixed freshness and engagement gave. */
export const MOMENTUM_MAX = 14;

/**
 * Timing points, 0 to `MOMENTUM_MAX`: how fresh (5) and how fast it gathers (9), both fading on
 * the half-life. The pace is engagement per half-life so far, padded by a quarter half-life so a
 * new post's first likes do not read as a surge. An unknown age reads as one half-life. A
 * crowded thread costs a point or two: a new comment there is buried.
 */
export function momentum(
  p: Pick<FeedPost, "reactions" | "comments">,
  ageH: number | null,
  halfLifeHours: number,
): number {
  const h = halfLifeHours;
  const age = ageH ?? h;
  const decay = 0.5 ** (age / h);
  const pace = ((p.reactions + 3 * p.comments) / (age + h / 4)) * h;
  const crowd = p.comments >= 500 ? 2 : p.comments >= 150 ? 1 : 0;
  const pts = 5 * decay + Math.min(9, 3 * Math.log10(1 + pace * decay));
  return Math.max(0, Math.min(MOMENTUM_MAX, Math.round(pts)) - crowd);
}

/** Owns or runs the firm (tier 1), or runs a part of it (tier 2). */
const TIER1 =
  /\b(founder|co-founder|owner|co-owner|ceo|cfo|coo|cto|cmo|cro|chief|(?<!vice )president|partner|principal|managing director|managing member)\b/i;
const TIER2 = /\b(vp|vice president|head of|director|general manager)\b/i;
/** A headline that sells to businesses: the audience's vendors, not the audience. */
const SELLER =
  /\b(?:i|we) help\b|\bhelping\b|\b(?:expert|consultant|coach|strategist|architect|advisor|adviser|fractional|freelancer?)\b/i;

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

/** How often the audience's words start a word ("recruit" meets "recruiters"). */
const occurrences = (text: string, term: string) => {
  const ws = words(term);
  if (!ws.length) return 0;
  return text.split(` ${ws.join(" ")}`).length - 1;
};

const distinct = (text: string, re: RegExp) =>
  new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase().replace(/\s+/g, " "))).size;

/**
 * Running and growing a firm: clients, sales, money in. Counted once each. "Marketing" is left
 * out: in recruiting posts it is mostly a job field.
 */
const GROWTH =
  /\b(?:clients?|business development|new business|sales|revenue|pipeline|leads|outreach|prospect\w*|referrals?|retainers?|fees|margins?|billings?|invoices?|vendors?|pricing|cash|grow\w*|scal(?:e|es|ed|ing)|book of business|repeat business|reactivat\w*|follow[- ]?ups?|cold (?:email|call)\w*|crm|automat\w*|msps?|vms|profit\w*|agency owners?)\b/gi;
/** The author speaks as the one who runs the firm. Counted once each. */
const OWNER =
  /\b(?:my|our) (?:own )?(?:\w+ )?(?:agency|firm|business|company|desk)\b|\b(?:my|our) (?:clients?|candidates|recruiters|consultants|billings?|pipeline|team)\b|\bwe placed\b|\bi (?:started|founded|built|run|own) (?:my|our|a|the)\b|\b(?:my|our) (?:first|biggest|best|last) (?:client|placement|hire|deal)\b/gi;
/** A call to buy or sign up: a vendor's post, not a buyer's. */
const PITCH =
  /\bbook (?:a|your) (?:free )?(?:call|demo|audit)\b|\bdm me\b|\blink in (?:the )?comments\b|\bjoin (?:the|our) (?:waitlist|webinar|workshop|bootcamp|community)\b|\bregister (?:here|now|today)\b|\bsign up\b|\bfree (?:audit|trial|guide|template|consultation)\b|\blimited (?:spots|seats)\b/i;

/** Points for how deep in the audience's world (0 to 3), growth words (0 to 3), owner voice (0 to 2). */
const AUDIENCE_POINTS = [0, 16, 28, 36];
const GROWTH_POINTS = [0, 8, 16, 24];
const OWNER_POINTS = [0, 6, 10];

/** Says it is a job ad. */
const HIRING =
  /#hiring\b|\b(?:we'?re|we are|now|is|are) hiring\b|\b(?:we'?re|we are|i'?m|i am|is|are) (?:actively |currently |now )?recruiting (?:an?|for|experienced|talented|reliable|qualified|new|\d+)\b|\bjob (?:title|description|type|summary)\b|\bapply (?:here|now|today|via|at|by|online)\b|\bemployment type\b|\binterested candidates\b|\bcandidates (?:must|should) (?:have|be)\b|\bsend (?:your|their|us your|me your) (?:cv|resume)s?\b/i;
/** What job ads are made of; three of them make one. */
const JOB =
  /\b(?:salary|requirements|responsibilities|qualifications|\d+\+? years?'? (?:of )?experience|at least \d+ years?|full[- ]time|part[- ]time|remote|w2|c2c|1099|per hour|hourly|per annum|day shift|night shift|\d+(?:\.\d+)?-hour shifts?|\d+ days (?:per|a) week|start date|benefits include|what you'll do|what you bring|(?:is|are) (?:actively )?looking for)\b/gi;
/** A job ad's field labels ("Location:", "Rate:"); three make one. */
const FIELD =
  /\b(?:location|salary|rate|pay|bonus|benefits|client|interviews?|contract|start date|duration|experience|employment type|industry|job type|schedule|hours|compensation|position|shift)\s*:/gi;
/** The author wants a job. */
const SEEKER =
  /\bopen to (?:work|new (?:roles|opportunities))\b|#opentowork\b|\b(?:i'?m|i am) (?:currently |now |actively )?(?:looking|searching) for (?:a|an|my next|new)\b[^.\n]{0,60}\b(?:role|position|job|opportunit\w*|work)\b|\blooking for (?:a|an|my) [^.\n]{0,40}\b(?:role|position|job|opportunit)|\b(?:you'?re|you are) (?:recruiting|hiring) for\b|\bhappy to (?:\w+ ){0,4}interview\b/i;
const SEEKER_HEAD =
  /\bopen to (?:work|new (?:roles|opportunities))\b|#?opentowork\b|\bavailable for\b|\b(?:seeking|looking for) (?:new |my next |a new )?(?:opportunit\w*|roles?|positions?|work)\b/i;
/** Speaks to people who want a job; two of these, or one promise to place them, make one. */
const CAREER =
  /\b(?:get|land|find|landing|getting|finding) (?:a|your|the|that) (?:\w+ )?(?:job|role)\b|\bjob ?seekers?\b|\bjob (?:search|hunt)\w*|\b(?:your|my) (?:cv|resume)\b|\binterview (?:tips|prep\w*)\b|\bstudents?\b|\bgraduat(?:e|es|ing)\b|\bcareer (?:advice|tips|change)\b/gi;
const PLACE_YOU =
  /\b(?:get|place) you (?:a job|hired|placed|in a (?:new )?(?:job|role))\b|\bcan place you\b/i;

type JobPost = "a job ad" | "a job seeker" | "for job seekers";

/**
 * A job ad, a job seeker's post, or a post for job seekers: no buyer reads it. The headline
 * counts too ("Open to work").
 */
export function jobPost(text: string, headline = ""): JobPost | null {
  const t = text.replace(/[‘’]/g, "'");
  if (HIRING.test(t) || distinct(t, JOB) >= 3 || distinct(t, FIELD) >= 3) return "a job ad";
  if (SEEKER.test(t) || SEEKER_HEAD.test(headline)) return "a job seeker";
  if (PLACE_YOU.test(t) || distinct(t, CAREER) >= 2) return "for job seekers";
  return null;
}

/** Any of `jobPost`'s three. */
export const isJobAd = (text: string, headline = ""): boolean => jobPost(text, headline) !== null;

/** Who wrote it: an owner in the audience's world, a vendor to it, or neither. */
export function authorFit(
  headline: string,
  audience: readonly string[],
): { points: number; kind: "buyer" | "seller" | "owner" | "manager" | null } {
  if (!headline.trim()) return { points: 0, kind: null };
  const head = ` ${words(headline).join(" ")} `;
  const theirs = audience.some((a) => occurrences(head, a) > 0);
  // "Recruitment Consultant" is the trade's own job title, not a vendor to it.
  const trade = audience.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const staff = trade ? new RegExp(`\\b(?:${trade})\\w*\\s+consultants?\\b`, "gi") : null;
  const rest = staff ? headline.replace(staff, " ") : headline;
  if (SELLER.test(rest)) return { points: -15, kind: "seller" };
  if (TIER1.test(headline))
    return theirs ? { points: 18, kind: "buyer" } : { points: 10, kind: "owner" };
  if (TIER2.test(headline)) return { points: theirs ? 10 : 5, kind: "manager" };
  if (rest !== headline) return { points: 5, kind: "manager" };
  return { points: 0, kind: null };
}

const AUTHOR_WHY = {
  buyer: "Runs a firm in their world.",
  seller: "Sells to them.",
  owner: null,
  manager: null,
} as const;

/**
 * Code's rank, 0 to 100, the line To approve shows, and why it is off target (a job ad, a job
 * seeker, a post for job seekers, or none of the audience's words, unless an owner in that world
 * wrote it), else null. Most of it is what the post is about: the audience's world (its words,
 * the author's headline) and growing a firm (growth words, said as the owner). Then who wrote it
 * (an owner in that world over a vendor to it), people we know, topic hits, engagement,
 * freshness; a pitch costs points.
 */
export function rankPost(
  p: FeedPost,
  o: {
    topics: readonly string[];
    audience?: readonly string[];
    key: boolean;
    foundBy: string;
    halfLifeHours: number;
    now: Date;
  },
): { fit: number; why: string; off: string | null } {
  const text = ` ${words(p.text).join(" ")} `;
  const hits = o.topics.filter((t) => {
    const ws = words(topicCore(t));
    return ws.length > 0 && ws.every((w) => text.includes(` ${w}`));
  });
  const head = p.headline ?? "";
  const headText = ` ${words(head).join(" ")} `;
  const audience = o.audience ?? DEFAULT_AUDIENCE;
  // In the audience's world: how often the post says so, and the author's own headline (2).
  const said = audience.reduce((n, a) => n + occurrences(text, a), 0);
  const theirs = audience.some((a) => occurrences(headText, a) > 0);
  const aud = Math.min(3, said + (theirs ? 2 : 0));
  const growth = new Set(
    [...p.text.matchAll(GROWTH)].map((m) => m[0].toLowerCase().replace(/s$/, "")),
  );
  const owner = Math.min(2, distinct(p.text, OWNER));
  const author = authorFit(head, audience);
  const pitch = PITCH.test(p.text);
  const at = p.at ? Date.parse(p.at) : Number.NaN;
  const ageH = Number.isNaN(at) ? null : Math.max(0, (o.now.getTime() - at) / HOUR);
  const timing = momentum(p, ageH, o.halfLifeHours);
  const fit = Math.max(
    0,
    Math.min(
      100,
      (AUDIENCE_POINTS[aud] ?? 0) +
        (GROWTH_POINTS[Math.min(3, growth.size)] ?? 0) +
        (OWNER_POINTS[owner] ?? 0) +
        author.points +
        Math.min(2, hits.length) * 4 +
        (o.key ? 20 : 0) +
        timing -
        (pitch ? 8 : 0),
    ),
  );
  const off =
    jobPost(p.text, head) ??
    // An owner in the audience's world, or someone we invited, may not name it; anyone else must.
    (audience.length && !said && !o.key && author.kind !== "buyer"
      ? `not about ${audience.slice(0, 3).join(", ")}`
      : null);
  const why = [
    head ? head.slice(0, 80) : null,
    author.kind ? AUTHOR_WHY[author.kind] : null,
    o.key ? "Someone we know." : null,
    hits.length ? `On ${hits.map((h) => `"${h}"`).join(", ")}.` : `Found by ${o.foundBy}.`,
    growth.size ? `Talks ${[...growth].slice(0, 3).join(", ")}.` : null,
    pitch ? "Pitches." : null,
    `${p.reactions} reactions, ${p.comments} comments${p.age ? `, ${p.age} old` : ""}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return { fit, why, off };
}

/**
 * What a post must say to hit a search: a boolean search (`"recruitment agency" (clients OR fees)`,
 * LinkedIn and X both read it) hits on its first quoted phrase; plain words are themselves.
 */
export function topicCore(topic: string): string {
  return /^\s*"([^"]+)"/.exec(topic)?.[1] ?? topic;
}
