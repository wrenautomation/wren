/**
 * Surveys (designs/2026-10-06-flags-experiments-surveys-heatmaps.md §4): one question, when it
 * shows and who sees it, in words the team edits. A site survey goes to the lander with the site
 * flags (`./flag-store.ts` pushEdge) and its card picks the moment there; a portal survey shows
 * in the app to the client logins it names. No database here: the edge and the web read it too.
 */

export const SURVEY_KINDS = ["choice", "scale", "text"] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];
export const SURVEY_SURFACES = ["site", "portal"] as const;
export type SurveySurface = (typeof SURVEY_SURFACES)[number];
export const SURVEY_STATES = ["draft", "live", "paused"] as const;
export type SurveyState = (typeof SURVEY_STATES)[number];
/** view: on the page, after a delay; exit: leaving the tab; form: after a form's submit; book: a Book a call click; booked: the booking confirmed. */
export const SURVEY_EVENTS = ["view", "exit", "form", "book", "booked"] as const;
export type SurveyEvent = (typeof SURVEY_EVENTS)[number];
/** A site visitor's first touch (`./clients/touch.ts`), `other` and `direct` as the site rollup has them. */
export const SITE_CHANNELS = [
  "email",
  "sms",
  "ads",
  "content",
  "search",
  "reach",
  "other",
  "direct",
] as const;

export interface SurveyTrigger {
  on: SurveyEvent;
  /** A site path; unset is any page. */
  page?: string;
  /** Seconds after the event on the site; days since the login joined in the portal. */
  after?: number;
}

/** Every part given must hold; none is everyone. */
export interface SurveyAudience {
  /** Site: the visitor's first touch. */
  channels?: string[];
  /** Site: the visitor is in this variant of a site flag. */
  flag?: { key: string; variant: string };
  /** Portal: these clients' logins. */
  clients?: string[];
}

/** What the lander gets for a live site survey. */
export interface SurveyDef {
  key: string;
  question: string;
  kind: SurveyKind;
  choices: string[];
  trigger: SurveyTrigger;
  audience: SurveyAudience;
}

const PATH = /^\/[A-Za-z0-9/_.-]{0,199}$/;
const ID = /^[a-z][a-z0-9_.-]{0,59}$/;
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * `view on /agencies after 20s`, `exit`, `form`, `book`, `booked`; in the portal `view after 30d`.
 * Empty is `view` with no delay.
 */
export function parseTrigger(
  text: string,
  surface: SurveySurface,
): { trigger: SurveyTrigger } | { error: string } {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const on = (words.shift() ?? "view") as SurveyEvent;
  if (!SURVEY_EVENTS.includes(on)) return { error: `when is one of ${SURVEY_EVENTS.join(", ")}` };
  if (surface === "portal" && on !== "view")
    return { error: "a portal survey shows on `view`, with `after <n>d`" };
  const trigger: SurveyTrigger = { on };
  while (words.length) {
    const w = words.shift();
    const v = words.shift() ?? "";
    if (w === "on" && surface === "site") {
      if (!PATH.test(v)) return { error: "`on` takes a path like /agencies" };
      trigger.page = v.length > 1 ? v.replace(/\/$/, "") : v;
    } else if (w === "after") {
      const m = v.match(surface === "site" ? /^(\d{1,3})s$/ : /^(\d{1,3})d$/);
      if (!m)
        return {
          error:
            surface === "site" ? "`after` takes seconds, like 20s" : "`after` takes days, like 30d",
        };
      trigger.after = Number(m[1]);
    } else return { error: `don't know "${w}"` };
  }
  return { trigger };
}

export const formatTrigger = (t: SurveyTrigger, surface: SurveySurface): string =>
  [
    t.on,
    t.page ? `on ${t.page}` : "",
    t.after ? `after ${t.after}${surface === "site" ? "s" : "d"}` : "",
  ]
    .filter(Boolean)
    .join(" ");

/** `channels email, search; flag hero b` on the site, `clients acme, beta` in the portal; lines or `;` between. Empty is everyone. */
export function parseAudience(
  text: string,
  surface: SurveySurface,
): { audience: SurveyAudience } | { error: string } {
  const audience: SurveyAudience = {};
  for (const part of text
    .split(/[;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [w = "", ...rest] = part.split(/\s+/);
    const tail = rest.join(" ").toLowerCase();
    if ((w === "channels" || w === "channel") && surface === "site") {
      const cs = list(tail);
      const bad = cs.find((c) => !(SITE_CHANNELS as readonly string[]).includes(c));
      if (!cs.length || bad) return { error: `channels are ${SITE_CHANNELS.join(", ")}` };
      audience.channels = cs;
    } else if (w === "flag" && surface === "site") {
      const [key = "", variant = "", ...more] = tail.split(/\s+/);
      if (!ID.test(key) || !variant || more.length) return { error: "`flag <key> <variant>`" };
      audience.flag = { key, variant };
    } else if ((w === "clients" || w === "client") && surface === "portal") {
      const cs = list(tail);
      if (!cs.length) return { error: "`clients <id>, <id>`" };
      audience.clients = cs;
    } else
      return {
        error:
          surface === "site"
            ? "who is `channels <list>` or `flag <key> <variant>`"
            : "who is `clients <list>`",
      };
  }
  return { audience };
}

export const formatAudience = (a: SurveyAudience): string =>
  [
    a.channels?.length ? `channels ${a.channels.join(", ")}` : "",
    a.flag ? `flag ${a.flag.key} ${a.flag.variant}` : "",
    a.clients?.length ? `clients ${a.clients.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

/** Choices as the team types them, one per line or comma between; a scale has none. */
export function parseChoices(
  text: string,
  kind: SurveyKind,
): { choices: string[] } | { error: string } {
  const choices = text
    .split(/[\n,]/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (kind !== "choice")
    return choices.length ? { error: `a ${kind} question has no choices` } : { choices: [] };
  if (choices.length < 2 || choices.length > 8) return { error: "2 to 8 choices" };
  if (choices.some((c) => c.length > 80)) return { error: "a choice is at most 80 characters" };
  if (new Set(choices).size !== choices.length) return { error: "each choice once" };
  return { choices };
}

export const SCALE = Array.from({ length: 10 }, (_, i) => String(i + 1));

/** An answer as stored, or null when it doesn't fit the question. */
export function answerOf(
  kind: SurveyKind,
  choices: readonly string[],
  value: unknown,
): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const v = String(value).trim();
  if (kind === "choice") return choices.includes(v) ? v : null;
  if (kind === "scale") return SCALE.includes(v) ? v : null;
  return v.length >= 1 && v.length <= 500 ? v : null;
}
