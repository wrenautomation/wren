/**
 * The typed offer contract. An offer is what we sell, to whom, on what terms, and how we
 * will know it was worth it. It is data: the lander renders it, an email arm pitches it,
 * an enrollment and a deal are stamped with its id. Nothing here knows a niche, a channel
 * or a page layout; those point at offers, never the other way.
 *
 * Copy that sells the offer (headlines, stories) lives with the channel. What lives here
 * is what must not drift between channels: the promise, the terms, what each side gives,
 * the application a buyer fills in, and the numbers that say whether it worked.
 */

export const OFFER_STATUSES = ["draft", "live", "paused", "retired"] as const;
/** `live` may be pitched; `draft` is being written; `paused` is full or on hold; `retired` is history. */
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Whole US dollars, both ends inclusive. */
export interface UsdRange {
  readonly min: number;
  readonly max: number;
}

export type Price =
  | { readonly kind: "free" }
  /** Priced on the call, from what the audit or the pilot found. */
  | { readonly kind: "quoted" }
  | {
      readonly kind: "fixed";
      readonly upfront: UsdRange | null;
      readonly monthly: UsdRange | null;
    }
  /** Paid for results: a setup fee, then a fee per unit delivered, up to a cap on those fees. */
  | {
      readonly kind: "performance";
      readonly upfront: number;
      readonly perUnit: number;
      /** What is counted, singular: "meeting booked". */
      readonly unit: string;
      /** The most the per-unit fees add up to, or null for no cap. */
      readonly cap: number | null;
      /** A monthly fee on top (tools, domains, inboxes), or null for none. */
      readonly monthly: number | null;
      /** The same work paid all upfront instead, with no per-unit fee, or null if not offered. */
      readonly flat: number | null;
      /** Past `days`, it carries on (monthly fee and all) until this many units, or null to stop at `days`. */
      readonly until: number | null;
      /**
       * Every fee back if there are no units by `days`, when the client gave at least
       * `minContacts` reachable contacts and kept up their side; null for no refund.
       */
      readonly refundIfNone: { readonly minContacts: number } | null;
    };

export interface Choice {
  /** Stored in the answers, so never renamed once an application uses it. */
  readonly id: string;
  readonly label: string;
}

/** One question on the application. `one` = pick one, `many` = pick any, `text` = free text. */
export type Question =
  | {
      readonly id: string;
      readonly ask: string;
      readonly kind: "one" | "many";
      readonly choices: readonly Choice[];
      readonly required: boolean;
    }
  | {
      readonly id: string;
      readonly ask: string;
      readonly kind: "text";
      readonly placeholder: string;
      readonly required: boolean;
    };

/**
 * A fit gate: the answer to `question` must be one of `anyOf` (for `many`, at least one
 * picked choice must be). An unanswered question fails its gate. All gates must pass.
 * This is the whole rule language on purpose: the lander evaluates it too.
 */
export interface FitRule {
  readonly question: string;
  readonly anyOf: readonly string[];
}

export interface Application {
  readonly questions: readonly Question[];
  readonly fit: readonly FitRule[];
}

export const MEASURE_UNITS = ["count", "usd", "hours"] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** A number that says whether the offer was worth it; recorded per deal under `key`. */
export interface Measure {
  readonly key: string;
  readonly label: string;
  readonly unit: MeasureUnit;
}

/**
 * One phase of the work, in weeks from the start (week 1 is the first). The client's
 * plan is built from these on start, so the weeks we promise are the weeks they see.
 */
export interface Phase {
  /** Stable, kebab-case: a started plan's milestones keep it. */
  readonly id: string;
  readonly name: string;
  readonly from: number;
  /** The last week, or null when it runs on (a retainer). */
  readonly to: number | null;
  /** What the client gets out of this phase. */
  readonly deliverables: readonly string[];
  /** What we need from the client, due at the end of the phase's first week. */
  readonly asks: readonly string[];
}

/** A system of the client's we need into, asked for formally when the offer is bought. */
export interface AccessNeed {
  /** "Your ATS". */
  readonly system: string;
  /** How much, and no more: "Read only: candidates and open roles". */
  readonly scope: string;
  readonly why: string;
  /** How the client takes it back. */
  readonly revoke: string;
}

export interface Offer {
  /** Stable, kebab-case, stored on enrollments and deals. Never renamed; retire and add. */
  readonly id: string;
  readonly name: string;
  readonly status: OfferStatus;
  /** Who it is for, in one line. */
  readonly audience: string;
  /** The outcome, in one sentence. */
  readonly promise: string;
  readonly price: Price;
  /** Firms taken at once, or null for no cap. A real cap: the work one person can do well. */
  readonly slots: number | null;
  /**
   * How long it runs, or null for open-ended. Holidays don't count (`windowEnd`
   * in channel-email): they push the end out, they never skip a month.
   */
  readonly days: number | null;
  /** What the buyer gets. */
  readonly youGet: readonly string[];
  /** What the buyer puts in. */
  readonly youGive: readonly string[];
  /** What we get back. Only a free offer has to say. */
  readonly weGet: readonly string[];
  /** What happens if it does not work, or null. */
  readonly guarantee: string | null;
  readonly measures: readonly Measure[];
  /** Offers this one leads to, the ladder up. Ids in the registry. */
  readonly next: readonly string[];
  /** The site page that presents it (path), or null when only a channel pitches it. */
  readonly page: string | null;
  /** Where a fit applicant books the call, or null (then we reply with times). */
  readonly booking: string | null;
  /**
   * The offer's own video (the VSL), an https mp4. The site plays it at /watch/<id> and an
   * email's `{link.watch}` points there when the firm has no demo of its own. Left out: none.
   */
  readonly video?: string;
  /** The form a buyer fills in first, or null when the first step is a reply. */
  readonly application: Application | null;
  /** The phases a bought offer runs through. Left out: no plan, the work is one step. */
  readonly plan?: readonly Phase[];
  /** Access we ask for when it's bought. Left out: none. */
  readonly access?: readonly AccessNeed[];
  /**
   * Firsts worth a review ask: the first time a measure reaches 1 ("Your first meeting is
   * booked"). Halfway and the last week ask on every offer with `days`. Left out: none.
   */
  readonly reviewAfterFirst?: readonly { readonly measure: string; readonly moment: string }[];
  /**
   * How this offer is put to a client already on one that lists it in `next`, at halfway
   * and in the last week. Left out: not offered to clients yet.
   */
  readonly upsell?: { readonly pitch: string };
  /**
   * The portal app it runs in; its plan, paperwork and reviews show there too. Left out: the
   * generic `work` app, for an offer with no app of its own.
   */
  readonly app?: string;
  /**
   * The one component offered to a client on this offer when they first open the portal,
   * preselected, with Install and Skip. Left out: none.
   */
  readonly addOn?: string;
  /** A performance price's measure: the count its per-unit fee bills ("meetings"). */
  readonly perUnitMeasure?: string;
}

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KEY = /^[a-z][a-z0-9_]*$/;
export const OFFER_ID_MAX = 64;

function unique(where: string, what: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${where}: ${what} '${id}' appears twice`);
    seen.add(id);
  }
}

function checkRange(where: string, r: UsdRange | null): void {
  if (r === null) return;
  if (!Number.isInteger(r.min) || !Number.isInteger(r.max) || r.min <= 0 || r.max < r.min) {
    throw new Error(`${where}: a price range needs whole dollars, 0 < min <= max`);
  }
}

function checkApplication(where: string, app: Application): void {
  if (app.questions.length === 0) throw new Error(`${where}: an application needs a question`);
  unique(
    where,
    "question",
    app.questions.map((q) => q.id),
  );
  const byId = new Map(app.questions.map((q) => [q.id, q] as const));
  for (const q of app.questions) {
    if (!KEY.test(q.id)) throw new Error(`${where}: question id '${q.id}' must be snake_case`);
    if (q.kind === "text") continue;
    if (q.choices.length < 2) throw new Error(`${where}: question '${q.id}' needs 2+ choices`);
    unique(
      `${where} question '${q.id}'`,
      "choice",
      q.choices.map((c) => c.id),
    );
    for (const c of q.choices) {
      if (!KEY.test(c.id)) {
        throw new Error(`${where}: choice id '${c.id}' in '${q.id}' must be snake_case`);
      }
    }
  }
  for (const rule of app.fit) {
    const q = byId.get(rule.question);
    if (q === undefined)
      throw new Error(`${where}: fit rule names unknown question '${rule.question}'`);
    if (q.kind === "text") throw new Error(`${where}: fit rule on text question '${q.id}'`);
    if (!q.required) {
      // An optional question that gates fit would turn a skipped answer into a no.
      throw new Error(`${where}: fit rule on optional question '${q.id}'`);
    }
    if (rule.anyOf.length === 0) throw new Error(`${where}: fit rule on '${q.id}' allows nothing`);
    const known = new Set(q.choices.map((c) => c.id));
    const bad = rule.anyOf.filter((id) => !known.has(id));
    if (bad.length) throw new Error(`${where}: fit rule on '${q.id}' names ${bad.join(", ")}`);
  }
}

function checkPlan(where: string, plan: readonly Phase[]): void {
  if (plan.length === 0) throw new Error(`${where}: a plan needs a phase, or leave it out`);
  unique(
    where,
    "phase",
    plan.map((p) => p.id),
  );
  for (const p of plan) {
    if (!ID.test(p.id)) throw new Error(`${where}: phase id '${p.id}' must be kebab-case`);
    if (!p.name.trim()) throw new Error(`${where}: phase '${p.id}' needs a name`);
    if (!Number.isInteger(p.from) || p.from < 1)
      throw new Error(`${where}: phase '${p.id}' starts in a whole week, 1 or later`);
    if (p.to !== null && (!Number.isInteger(p.to) || p.to < p.from))
      throw new Error(`${where}: phase '${p.id}' ends in a whole week, not before it starts`);
  }
}

/** Build and check one offer. Registry-wide checks (ladder, pages) live in the registry. */
export function defineOffer(offer: Offer): Offer {
  const where = `offer '${offer.id}'`;
  if (!ID.test(offer.id) || offer.id.length > OFFER_ID_MAX) {
    throw new Error(`${where}: id must be kebab-case, at most ${OFFER_ID_MAX} chars`);
  }
  if (!offer.name.trim() || !offer.audience.trim() || !offer.promise.trim()) {
    throw new Error(`${where}: name, audience and promise are required`);
  }
  if (!OFFER_STATUSES.includes(offer.status)) throw new Error(`${where}: bad status`);
  if (offer.price.kind === "fixed") {
    if (offer.price.upfront === null && offer.price.monthly === null) {
      throw new Error(`${where}: a fixed price needs an upfront or a monthly range`);
    }
    checkRange(where, offer.price.upfront);
    checkRange(where, offer.price.monthly);
  }
  if (offer.price.kind === "performance") {
    const { upfront, perUnit, unit, cap } = offer.price;
    if (!Number.isInteger(upfront) || upfront < 0 || !Number.isInteger(perUnit) || perUnit <= 0) {
      throw new Error(
        `${where}: a performance price needs whole dollars, upfront >= 0, perUnit > 0`,
      );
    }
    if (!unit.trim()) throw new Error(`${where}: say what a performance price counts (unit)`);
    if (cap !== null && (!Number.isInteger(cap) || cap < perUnit)) {
      throw new Error(`${where}: a cap is whole dollars, at least one unit's fee`);
    }
    const { monthly, flat, until } = offer.price;
    for (const [k, v] of [
      ["monthly", monthly],
      ["flat", flat],
      ["until", until],
    ] as const)
      if (v !== null && (!Number.isInteger(v) || v <= 0))
        throw new Error(`${where}: a performance price's ${k} is a whole number above 0`);
    if (until !== null && offer.days === null)
      throw new Error(`${where}: "until" carries on past days, so it needs days`);
    const refund = offer.price.refundIfNone;
    if (refund !== null && (!Number.isInteger(refund.minContacts) || refund.minContacts <= 0))
      throw new Error(`${where}: a refund's minContacts is a whole number above 0`);
    if (refund !== null && offer.days === null)
      throw new Error(`${where}: a refund if none by day N needs days`);
  }
  if (offer.price.kind === "free" && offer.weGet.length === 0) {
    // Free is a trade. Saying what we get back is what makes it believable.
    throw new Error(`${where}: a free offer must say what we get back (weGet)`);
  }
  for (const [name, n] of [
    ["slots", offer.slots],
    ["days", offer.days],
  ] as const) {
    if (n !== null && (!Number.isInteger(n) || n <= 0)) {
      throw new Error(`${where}: ${name} must be a positive whole number or null`);
    }
  }
  if (offer.youGet.length === 0) throw new Error(`${where}: say what the buyer gets (youGet)`);
  if (offer.measures.length === 0) {
    throw new Error(`${where}: an offer needs a measure, or nobody can say it worked`);
  }
  unique(
    where,
    "measure",
    offer.measures.map((m) => m.key),
  );
  for (const m of offer.measures) {
    if (!KEY.test(m.key)) throw new Error(`${where}: measure key '${m.key}' must be snake_case`);
    if (!MEASURE_UNITS.includes(m.unit)) throw new Error(`${where}: measure '${m.key}' bad unit`);
  }
  if (offer.next.includes(offer.id)) throw new Error(`${where}: an offer cannot lead to itself`);
  unique(where, "next offer", offer.next);
  // "/" or plain lowercase segments: a service's family, then the offer ("/recruiting/lead-reactivation")
  if (offer.page !== null && !/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(offer.page)) {
    throw new Error(`${where}: page must be a site path like '/recruiting/lead-reactivation'`);
  }
  if (offer.booking !== null && !offer.booking.startsWith("https://")) {
    throw new Error(`${where}: booking must be an https URL`);
  }
  if (offer.video !== undefined && !/^https:\/\/\S+\.mp4$/.test(offer.video)) {
    throw new Error(`${where}: video must be an https URL to an mp4`);
  }
  if (offer.application !== null) checkApplication(where, offer.application);
  if (offer.plan) checkPlan(where, offer.plan);
  for (const f of offer.reviewAfterFirst ?? []) {
    if (!offer.measures.some((m) => m.key === f.measure))
      throw new Error(`${where}: reviewAfterFirst names '${f.measure}', not one of its measures`);
    if (!f.moment.trim()) throw new Error(`${where}: say what the first '${f.measure}' is`);
  }
  if (offer.upsell && !offer.upsell.pitch.trim())
    throw new Error(`${where}: an upsell needs a pitch, or leave it out`);
  if (offer.app !== undefined && !ID.test(offer.app))
    throw new Error(`${where}: app must be a kebab-case app id`);
  if ((offer.price.kind === "performance") !== (offer.perUnitMeasure !== undefined))
    throw new Error(`${where}: a performance price, and only one, names its perUnitMeasure`);
  if (
    offer.perUnitMeasure !== undefined &&
    !offer.measures.some((m) => m.key === offer.perUnitMeasure)
  )
    throw new Error(
      `${where}: perUnitMeasure '${offer.perUnitMeasure}' is not one of its measures`,
    );
  for (const a of offer.access ?? [])
    if (![a.system, a.scope, a.why, a.revoke].every((t) => t.trim()))
      throw new Error(`${where}: access to '${a.system}' needs a system, scope, why and revoke`);
  return offer;
}

/** Answers as stored: a choice id, several choice ids, or text, by question id. */
export type Answers = Readonly<Record<string, string | readonly string[]>>;

/** Whether the answers pass every fit gate. An offer without an application always fits. */
export function fits(offer: Offer, answers: Answers): boolean {
  const app = offer.application;
  if (app === null) return true;
  return app.fit.every((rule) => {
    const got = answers[rule.question];
    const picked = typeof got === "string" ? [got] : (got ?? []);
    return picked.some((id) => rule.anyOf.includes(id));
  });
}

/** The first check an application fails, as a message, or null when it is complete and well-formed. */
export function invalidAnswers(offer: Offer, answers: Answers): string | null {
  const app = offer.application;
  if (app === null) return `offer '${offer.id}' takes no application`;
  const byId = new Map(app.questions.map((q) => [q.id, q] as const));
  for (const key of Object.keys(answers)) {
    if (!byId.has(key)) return `unknown question '${key}'`;
  }
  for (const q of app.questions) {
    const got = answers[q.id];
    const empty = got === undefined || (typeof got === "string" ? !got.trim() : got.length === 0);
    if (empty) {
      if (q.required) return `'${q.id}' is required`;
      continue;
    }
    if (q.kind === "text") {
      if (typeof got !== "string") return `'${q.id}' takes text`;
      continue;
    }
    const picked = typeof got === "string" ? [got] : (got as readonly string[]);
    if (q.kind === "one" && picked.length !== 1) return `'${q.id}' takes one choice`;
    const known = new Set(q.choices.map((c) => c.id));
    const bad = picked.find((id) => !known.has(id));
    if (bad !== undefined) return `'${q.id}' has no choice '${bad}'`;
  }
  return null;
}

/**
 * What copy may quote from an offer, as `offer.*` facts: `{offer.days}`, `{offer.slots}`,
 * `{offer.page}`, `{offer.goal}` (the units a performance offer runs until). A term the offer leaves null is absent, so copy quoting it refuses instead
 * of printing a guess. Email templates and the lander read the same terms this way.
 */
export function offerFacts(offer: Offer): Readonly<Record<string, string>> {
  return {
    "offer.name": offer.name,
    ...(offer.days === null ? {} : { "offer.days": String(offer.days) }),
    ...(offer.slots === null ? {} : { "offer.slots": String(offer.slots) }),
    ...(offer.page === null ? {} : { "offer.page": offer.page }),
    ...(offer.video === undefined ? {} : { "offer.video": offer.video }),
    ...(offer.price.kind === "performance" && offer.price.until !== null
      ? { "offer.goal": String(offer.price.until) }
      : {}),
  };
}
