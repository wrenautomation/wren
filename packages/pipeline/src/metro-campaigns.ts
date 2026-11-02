/**
 * Campaigns on the metro map (designs/2026-11-02-campaigns.md): a campaign is a group with a
 * `campaign` field. Its id is the group id. A field left unset comes from the nearest campaign
 * above it; `accounts` and `caps` inherit key by key. Every station outside a campaign sits in the
 * default campaign, computed here and never stored. Pure: browser-safe (the portal draws it).
 */
import type { Platform } from "@wren/core/content";
import type { MetroBody, MetroGroup, MetroLine, MetroStation } from "./metro.js";
import { type Action, GROUP_ID, type ShapeCheckContext } from "./model.js";

export const CAMPAIGN_STATUSES = ["live", "paused", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** The station actions a CTA may point at. */
export const CTA_ACTIONS = ["cta", "form", "visit", "book"] as const satisfies readonly Action[];

/** The computed campaign of every station outside a campaign group. No group may take its id. */
export const DEFAULT_CAMPAIGN = "default";

/** The sites platforms; the type keeps this list equal to core's `Platform`. */
const SITE_PLATFORMS = {
  linkedin: true,
  reddit: true,
  youtube: true,
  x: true,
  instagram: true,
  threads: true,
  facebook: true,
  tiktok: true,
  google_business: true,
} as const satisfies Record<Platform, true>;
/** What `accounts` and `caps` key by: a sites platform, or cold email and text. */
export const CAMPAIGN_CHANNELS: readonly string[] = [
  ...Object.keys(SITE_PLATFORMS),
  "email",
  "sms",
];

/**
 * The acts a loop spends, per channel. A channel listed here refuses other acts; a channel not
 * listed takes any slug until its loop reads campaigns (designs/2026-11-02-campaigns.md, phase 3).
 */
const CAMPAIGN_ACTS: Readonly<Record<string, readonly string[]>> = {
  // Cold email: openers queued a day (`ComposeScheduler`).
  email: ["opener"],
};

/** The widest a day cap goes. */
export const CAP_MAX = 10_000;
/** The longest an account id or a CTA label may be, in characters. */
const ACCOUNT_MAX = 120;
const LABEL_MAX = 80;
const CAP_KEY = /^([a-z_]+)\.([a-z][a-z_]*)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ["offer", "audience", "ctas", "accounts", "caps", "from", "until", "status"];

export interface Cta {
  label: string;
  /** A station inside the campaign's group, or a group below it, with a CTA action. */
  station: string;
}

/** Who a campaign is for: a stored segment, or the out lines that feed it. */
export interface Audience {
  segment?: string;
  lines?: string[];
}

/** A group's campaign fields. Each is optional; `{}` makes the group a campaign. */
export interface CampaignFields {
  /** A registry offer id: what its CTAs sell. */
  offer?: string;
  audience?: Audience;
  /** The CTA ladder, in order. */
  ctas?: Cta[];
  /** Per channel, the account that acts (`linkedin: william`). */
  accounts?: Record<string, string>;
  /** Per `<channel>.<act>`, a day cap under the platform's own (`linkedin.comment: 20`). */
  caps?: Record<string, number>;
  /** `YYYY-MM-DD`. None: open-ended. */
  from?: string;
  until?: string;
  status?: CampaignStatus;
}

/** A campaign with its inherited fields filled in. */
export interface Campaign {
  id: string;
  label: string;
  /** The nearest campaign above it. None on a top campaign and on the default. */
  parent?: string;
  offer?: string;
  audience?: Audience;
  ctas: Cta[];
  accounts: Record<string, string>;
  caps: Record<string, number>;
  from?: string;
  until?: string;
  /** Its own, else its parent's; a paused or ended parent holds every campaign inside it. */
  status: CampaignStatus;
  /** The stations whose nearest campaign is this one. */
  stations: string[];
  /** The fields set on the group itself. */
  own: CampaignFields;
}

const isMap = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const isDay = (v: unknown): v is string =>
  typeof v === "string" &&
  DAY.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** The groups by id and the groups inside each. */
function treeOf(groups: readonly MetroGroup[]) {
  const by = new Map(groups.map((g) => [g.id, g]));
  const kids = new Map<string, MetroGroup[]>();
  for (const g of groups)
    if (g.parent !== undefined) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g]);
  return { by, kids };
}

/** The nearest campaign group above `g` (not `g`). Stops on a loop; checkGroups reports it. */
function campaignAbove(g: MetroGroup, by: ReadonlyMap<string, MetroGroup>): MetroGroup | undefined {
  const seen = new Set([g.id]);
  for (let up = by.get(g.parent ?? ""); up && !seen.has(up.id); up = by.get(up.parent ?? "")) {
    if (up.campaign !== undefined) return up;
    seen.add(up.id);
  }
  return undefined;
}

/** Every station in `g` and in the groups below it. */
function stationsUnder(g: MetroGroup, kids: ReadonlyMap<string, MetroGroup[]>): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (x: MetroGroup) => {
    if (seen.has(x.id)) return;
    seen.add(x.id);
    for (const s of x.stations ?? []) out.add(s);
    for (const k of kids.get(x.id) ?? []) walk(k);
  };
  walk(g);
  return out;
}

const STRICT: Record<CampaignStatus, number> = { live: 0, paused: 1, ended: 2 };

/**
 * Every campaign of the body, inherited fields filled in: the default first, then each campaign
 * group in body order. Safe on a body that has not been checked.
 */
export function campaignsOf(body: MetroBody): Campaign[] {
  const { by } = treeOf(body.groups);
  const resolved = new Map<string, Campaign>();
  const resolve = (g: MetroGroup, open: Set<string>): Campaign => {
    const known = resolved.get(g.id);
    if (known) return known;
    const own = (isMap(g.campaign) ? g.campaign : {}) as CampaignFields;
    open.add(g.id);
    const upGroup = campaignAbove(g, by);
    const up = upGroup && !open.has(upGroup.id) ? resolve(upGroup, open) : undefined;
    const status = own.status ?? up?.status ?? "live";
    const c: Campaign = {
      id: g.id,
      label: g.label,
      ...(up ? { parent: up.id } : {}),
      ...pick("offer", own.offer ?? up?.offer),
      ...pick("audience", own.audience ?? up?.audience),
      ctas: own.ctas ?? up?.ctas ?? [],
      accounts: { ...up?.accounts, ...own.accounts },
      caps: { ...up?.caps, ...own.caps },
      ...pick("from", own.from ?? up?.from),
      ...pick("until", own.until ?? up?.until),
      status: up && STRICT[up.status] > STRICT[status] ? up.status : status,
      stations: [],
      own,
    };
    resolved.set(g.id, c);
    return c;
  };
  const campaigns = body.groups.filter((g) => g.campaign !== undefined);
  for (const g of campaigns) resolve(g, new Set());

  const fallback = defaultCampaign();
  const groupOf = new Map<string, MetroGroup>();
  for (const g of body.groups)
    for (const s of g.stations ?? []) if (!groupOf.has(s)) groupOf.set(s, g);
  for (const s of body.stations) {
    const g = groupOf.get(s.id);
    const home = g && (g.campaign !== undefined ? g : campaignAbove(g, by));
    (home ? (resolved.get(home.id) ?? fallback) : fallback).stations.push(s.id);
  }
  return [fallback, ...campaigns.map((g) => resolved.get(g.id) as Campaign)];
}

/** The default campaign, empty: no stations yet, fields unset, live. */
const defaultCampaign = (): Campaign => ({
  id: DEFAULT_CAMPAIGN,
  label: "Default",
  ctas: [],
  accounts: {},
  caps: {},
  status: "live",
  stations: [],
  own: {},
});

const pick = <K extends string, V>(k: K, v: V | undefined): { [P in K]?: V } =>
  (v === undefined ? {} : { [k]: v }) as { [P in K]?: V };

/**
 * The campaigns a loop pass runs on `day` (`YYYY-MM-DD`, UTC): live and inside their dates, in
 * body order, the default last. First come, first served is this order.
 */
export function liveCampaigns(body: MetroBody | null, day: string): Campaign[] {
  // A graph shape, or none: the default only.
  const [fallback, ...rest] = body ? campaignsOf(body) : [defaultCampaign()];
  return [
    ...rest.filter(
      (c) =>
        c.status === "live" &&
        (c.from === undefined || c.from <= day) &&
        (c.until === undefined || day <= c.until),
    ),
    fallback as Campaign,
  ];
}

/** The campaign that holds a station: its nearest campaign group, else the default. */
export function campaignOfStation(body: MetroBody, station: string): string {
  return campaignsOf(body).find((c) => c.stations.includes(station))?.id ?? DEFAULT_CAMPAIGN;
}

/**
 * The campaign fields of every group, and the reserved id. Called by `checkMetro`, after the
 * group rules, so a missing station or parent is reported once, there.
 */
export function checkCampaigns(
  groups: readonly MetroGroup[],
  lineBy: ReadonlyMap<string, MetroLine>,
  stationBy: ReadonlyMap<string, MetroStation>,
  ctx: ShapeCheckContext,
  errors: string[],
): void {
  const { kids } = treeOf(groups);
  for (const g of groups) {
    if (g.id === DEFAULT_CAMPAIGN)
      errors.push(`Group id "${DEFAULT_CAMPAIGN}" is reserved for the default campaign.`);
    if (g.campaign === undefined) continue;
    const who = `Campaign "${g.id}"`;
    const c: unknown = g.campaign;
    if (!isMap(c)) {
      errors.push(`${who} needs a map of campaign fields.`);
      continue;
    }
    for (const k of Object.keys(c))
      if (!FIELDS.includes(k)) errors.push(`${who}: ${k} is not a campaign field.`);

    if (c.offer !== undefined && (typeof c.offer !== "string" || c.offer === ""))
      errors.push(`${who} names no offer.`);
    if (c.status !== undefined && !CAMPAIGN_STATUSES.includes(c.status as CampaignStatus))
      errors.push(`${who} has status "${c.status}". Use ${CAMPAIGN_STATUSES.join(", ")}.`);
    checkAudience(who, c.audience, lineBy, ctx, errors);
    checkCtas(who, c.ctas, stationsUnder(g, kids), stationBy, errors);
    checkAccounts(who, c.accounts, errors);
    checkCaps(who, c.caps, errors);
    for (const k of ["from", "until"] as const)
      if (c[k] !== undefined && !isDay(c[k]))
        errors.push(`${who} has ${k} "${c[k]}". Use a date, YYYY-MM-DD.`);
  }

  // What a campaign gets from above: its dates, and caps no wider than its parent's.
  const resolved = campaignsOf({ groups, stations: [] } as unknown as MetroBody);
  const capsOf = new Map(resolved.map((r) => [r.id, r.caps]));
  for (const r of resolved) {
    if (isDay(r.from) && isDay(r.until) && r.from > r.until)
      errors.push(`Campaign "${r.id}" ends (${r.until}) before it starts (${r.from}).`);
    const above = r.parent ? capsOf.get(r.parent) : undefined;
    for (const [k, n] of Object.entries(r.own.caps ?? {})) {
      const cap = above?.[k];
      if (typeof n === "number" && typeof cap === "number" && n > cap)
        errors.push(
          `Campaign "${r.id}" caps ${k} at ${n}, over the ${cap} of campaign "${r.parent}".`,
        );
    }
  }
}

function checkAudience(
  who: string,
  a: unknown,
  lineBy: ReadonlyMap<string, MetroLine>,
  ctx: ShapeCheckContext,
  errors: string[],
): void {
  if (a === undefined) return;
  if (!isMap(a)) {
    errors.push(`${who} needs an audience with a segment or lines.`);
    return;
  }
  for (const k of Object.keys(a))
    if (k !== "segment" && k !== "lines") errors.push(`${who} audience: ${k} is not a field.`);
  if (a.segment === undefined && a.lines === undefined)
    errors.push(`${who} needs an audience with a segment or lines.`);
  if (a.segment !== undefined) {
    const s = a.segment;
    if (typeof s !== "string" || !GROUP_ID.test(s))
      errors.push(`${who} names segment "${s}", which is not a group's number.`);
    else {
      const found = ctx.group(s);
      if (!found) errors.push(`${who} names segment ${s}, which does not exist.`);
      else if (!found.active)
        errors.push(`${who} names segment ${s}, which is archived. Restore it first.`);
    }
  }
  if (a.lines !== undefined) {
    if (!Array.isArray(a.lines) || a.lines.length === 0) {
      errors.push(`${who} audience lines is a list of out lines.`);
      return;
    }
    for (const id of a.lines) {
      const l = lineBy.get(String(id));
      if (!l) errors.push(`${who} names audience line "${id}", which does not exist.`);
      else if (l.tier !== "out")
        errors.push(`${who} names audience line "${id}", which is not an out line.`);
    }
  }
}

function checkCtas(
  who: string,
  ctas: unknown,
  inside: ReadonlySet<string>,
  stationBy: ReadonlyMap<string, MetroStation>,
  errors: string[],
): void {
  if (ctas === undefined) return;
  if (!Array.isArray(ctas)) {
    errors.push(`${who} ctas is a list of a label and a station.`);
    return;
  }
  const seen = new Set<string>();
  for (const [i, x] of ctas.entries()) {
    const at = `${who} CTA ${i + 1}`;
    if (!isMap(x)) {
      errors.push(`${at} needs a label and a station.`);
      continue;
    }
    if (typeof x.label !== "string" || x.label.trim() === "" || x.label.length > LABEL_MAX)
      errors.push(`${at} needs a label of 1 to ${LABEL_MAX} characters.`);
    const id = String(x.station);
    const s = stationBy.get(id);
    if (!s) errors.push(`${at} names station "${id}", which is not in the shape.`);
    else if (!inside.has(id))
      errors.push(`${at} names station "${id}", which is not inside the campaign.`);
    else if (!s.action || !(CTA_ACTIONS as readonly string[]).includes(s.action))
      errors.push(`${at} names station "${id}", whose action is not ${CTA_ACTIONS.join(", ")}.`);
    if (seen.has(id)) errors.push(`${at} names station "${id}" twice.`);
    seen.add(id);
  }
}

function checkAccounts(who: string, accounts: unknown, errors: string[]): void {
  if (accounts === undefined) return;
  if (!isMap(accounts)) {
    errors.push(`${who} accounts is a map of channel to account.`);
    return;
  }
  for (const [ch, acct] of Object.entries(accounts)) {
    if (!CAMPAIGN_CHANNELS.includes(ch))
      errors.push(`${who} has an account on "${ch}". Use ${CAMPAIGN_CHANNELS.join(", ")}.`);
    if (typeof acct !== "string" || !/^\S+$/.test(acct) || acct.length > ACCOUNT_MAX)
      errors.push(
        `${who} account on ${ch} needs an id of 1 to ${ACCOUNT_MAX} characters, no spaces.`,
      );
  }
}

function checkCaps(who: string, caps: unknown, errors: string[]): void {
  if (caps === undefined) return;
  if (!isMap(caps)) {
    errors.push(`${who} caps is a map of <channel>.<act> to a day cap.`);
    return;
  }
  for (const [k, n] of Object.entries(caps)) {
    const m = CAP_KEY.exec(k);
    if (!m) errors.push(`${who} has cap "${k}". Use <channel>.<act>, as linkedin.comment.`);
    else if (!CAMPAIGN_CHANNELS.includes(m[1] as string))
      errors.push(`${who} caps "${m[1]}". Use ${CAMPAIGN_CHANNELS.join(", ")}.`);
    else {
      const acts = CAMPAIGN_ACTS[m[1] as string];
      if (acts && !acts.includes(m[2] as string))
        errors.push(`${who} caps ${k}. ${m[1]} acts: ${acts.join(", ")}.`);
    }
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > CAP_MAX)
      errors.push(
        `${who} caps ${k} at ${JSON.stringify(n)}. Use a whole number from 0 to ${CAP_MAX}.`,
      );
  }
}
