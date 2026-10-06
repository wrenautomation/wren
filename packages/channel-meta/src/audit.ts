/**
 * A Meta ad account audit (designs/2026-10-06-ads-audit.md). `gatherEvidence` reads the account,
 * campaigns, ad sets, ads, pixels and two insight windows; everything after is pure. Cold start is
 * judged per dimension (account, pixel, conversions) and never inferred across them; a cold one
 * turns off the rules that need history. Controls score by severity into category health and
 * evidence coverage. Recommendations are drafts: nothing here writes to Meta.
 *
 * The scoring contract and cold-start rules follow claude-ads (MIT, Copyright (c) 2026
 * agricidaniel): states pass/fail/unknown/not_applicable, weights critical 5 / high 3 / medium 1,
 * health = pass / known, coverage = known / applicable, graded at 80, provisional at 60.
 */
import { z } from "zod";
import type {
  AdAccount,
  AdRow,
  AdSetRow,
  CampaignRow,
  InsightRow,
  MetaAds,
  PixelRow,
} from "./ads.js";

export const auditSettingsSchema = z
  .object({
    /** A pixel quiet longer than this fails the firing check. */
    pixelStaleDays: z.number().int().min(1).max(90).default(7),
    /** Ads each live ad set should test at once. */
    minAdsPerAdset: z.number().int().min(1).max(10).default(3),
    /** Live ad sets per campaign before it reads as fragmented (warm accounts only). */
    maxAdsetsPerCampaign: z.number().int().min(1).max(50).default(5),
    /** Last 7 days' spend over live daily budgets × 7, below which budgets go unspent. */
    minBudgetUse: z.number().min(0).max(1).default(0.7),
    /** Days a conversion may lag its click: the conversion window ends this many days ago. */
    conversionLagDays: z.number().int().min(0).max(28).default(7),
  })
  .strict();
export type AuditSettings = z.infer<typeof auditSettingsSchema>;

export interface Evidence {
  now: string;
  account: AdAccount | null;
  campaigns: CampaignRow[] | null;
  adsets: AdSetRow[] | null;
  ads: AdRow[] | null;
  pixels: PixelRow[] | null;
  /** Account level, last 7 days. */
  recent: InsightRow[] | null;
  /** Account level, from the account's start to `conversionLagDays` ago. */
  matured: InsightRow[] | null;
  /** What could not be read, by part. */
  errors: Record<string, string>;
}

export type Cold = "cold" | "warm" | "unknown";
export interface ColdStart {
  account: Cold;
  pixel: Cold;
  conversion: Cold;
  why: { account: string; pixel: string; conversion: string };
}

export type Severity = "critical" | "high" | "medium" | "info";
export type ControlState = "pass" | "fail" | "unknown" | "not_applicable";
export type Category =
  | "measurement"
  | "creative"
  | "structure"
  | "audiences"
  | "delivery"
  | "policy";

export interface Control {
  id: string;
  category: Category;
  severity: Severity;
  state: ControlState;
  /** What the evidence showed, in one line. */
  detail: string;
}

export interface Draft {
  control: string | null;
  text: string;
}

export interface Audit {
  at: string;
  accountId: string | null;
  coldStart: ColdStart;
  /** Live = ACTIVE; when nothing delivers, the paused setup is checked instead. */
  scope: "live" | "paused";
  controls: Control[];
  categories: Partial<Record<Category, { health: number | null; coverage: number }>>;
  health: number | null;
  coverage: number;
  grade: "graded" | "provisional" | "insufficient";
  /** Unknown critical controls: always shown, whatever the grade. */
  gaps: string[];
  drafts: Draft[];
  errors: Record<string, string>;
}

const WEIGHT: Record<Severity, number> = { critical: 5, high: 3, medium: 1, info: 0 };
const CATEGORY_WEIGHT: Record<Category, number> = {
  measurement: 25,
  creative: 25,
  structure: 20,
  audiences: 15,
  delivery: 10,
  policy: 5,
};
const DAY_MS = 86_400_000;

/** Goals that optimize toward the objective's own outcome. */
const ALIGNED: Record<string, string[]> = {
  OUTCOME_LEADS: ["LEAD_GENERATION", "OFFSITE_CONVERSIONS", "QUALITY_LEAD", "CONVERSATIONS"],
  OUTCOME_SALES: ["OFFSITE_CONVERSIONS", "VALUE", "CONVERSATIONS"],
  OUTCOME_TRAFFIC: ["LINK_CLICKS", "LANDING_PAGE_VIEWS"],
  OUTCOME_AWARENESS: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT", "THRUPLAY"],
  OUTCOME_ENGAGEMENT: [
    "POST_ENGAGEMENT",
    "THRUPLAY",
    "CONVERSATIONS",
    "PAGE_LIKES",
    "EVENT_RESPONSES",
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
  ],
  OUTCOME_APP_PROMOTION: ["APP_INSTALLS", "OFFSITE_CONVERSIONS", "VALUE"],
};
/** Actions that count as an accepted conversion. */
const CONVERSION =
  /^(lead|purchase|complete_registration|onsite_conversion\.lead_grouped|offsite_conversion\..+)$/;
const GONE = new Set(["DELETED", "ARCHIVED"]);

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Every read on its own: one failing part leaves its evidence null, never the whole audit. */
export async function gatherEvidence(
  ads: MetaAds,
  now: Date,
  s: AuditSettings = auditSettingsSchema.parse({}),
): Promise<Evidence> {
  const errors: Record<string, string> = {};
  const read = async <T>(part: string, f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (e) {
      errors[part] = e instanceof Error ? e.message : String(e);
      return null;
    }
  };
  const account = await read("account", () => ads.account());
  // In turn, not in parallel: each is a journaled call when this runs on Restate.
  const campaigns = await read("campaigns", () => ads.campaigns());
  const adsets = await read("adsets", () => ads.adsets());
  const adRows = await read("ads", () => ads.ads());
  const pixels = await read("pixels", () => ads.pixels());
  const recent = await read("recent", () => ads.insights({ level: "account", preset: "last_7d" }));
  const until = new Date(now.getTime() - s.conversionLagDays * DAY_MS);
  // Graph keeps 37 months of insights; the window starts at the account's birth or there.
  const floor = new Date(now.getTime() - 36 * 30 * DAY_MS);
  const born = account?.created_time ? new Date(account.created_time) : null;
  const since = born && born > floor ? born : floor;
  const matured =
    since < until
      ? await read("matured", () =>
          ads.insights({ level: "account", range: { since: day(since), until: day(until) } }),
        )
      : [];
  return {
    now: now.toISOString(),
    account,
    campaigns,
    adsets,
    ads: adRows,
    pixels,
    recent,
    matured,
    errors,
  };
}

const conversionsIn = (rows: InsightRow[]) =>
  rows
    .flatMap((r) => r.actions ?? [])
    .filter((a) => CONVERSION.test(a.action_type))
    .reduce((n, a) => n + Number(a.value || 0), 0);

/** Each dimension from its own evidence; missing or contradictory evidence stays unknown. */
export function coldStart(e: Evidence): ColdStart {
  let account: Cold = "unknown";
  let accountWhy = "no account read";
  if (e.account?.amount_spent !== undefined) {
    const spent = Number(e.account.amount_spent);
    const delivered = (e.recent ?? []).some((r) => Number(r.impressions ?? 0) > 0);
    if (!Number.isFinite(spent)) accountWhy = "lifetime spend unreadable";
    else if (spent > 0) [account, accountWhy] = ["warm", `lifetime spend ${spent / 100}`];
    else if (delivered) accountWhy = "zero lifetime spend but recent impressions: contradictory";
    else [account, accountWhy] = ["cold", "zero lifetime spend"];
  }

  let pixel: Cold = "unknown";
  let pixelWhy = "no pixel read";
  if (e.pixels) {
    const live = e.pixels.filter((p) => !p.is_unavailable);
    if (live.length === 0) pixelWhy = "no pixel on the account";
    else if (live.some((p) => p.last_fired_time)) [pixel, pixelWhy] = ["warm", "a pixel has fired"];
    else [pixel, pixelWhy] = ["cold", "no pixel has ever fired"];
  }

  let conversion: Cold = "unknown";
  let conversionWhy = "no lag-mature insights";
  if (e.matured && e.matured.length > 0) {
    const n = conversionsIn(e.matured);
    [conversion, conversionWhy] =
      n > 0
        ? ["warm", `${n} conversions in the mature window`]
        : ["cold", "no conversions in the mature window"];
  } else if (e.matured && account === "cold")
    [conversion, conversionWhy] = ["cold", "never delivered, so nothing converted"];

  return {
    account,
    pixel,
    conversion,
    why: { account: accountWhy, pixel: pixelWhy, conversion: conversionWhy },
  };
}

const ageDays = (iso: string | undefined, now: Date) =>
  iso ? (now.getTime() - new Date(iso).getTime()) / DAY_MS : null;

/** The controls, from the evidence and the cold-start verdicts. */
export function controls(
  e: Evidence,
  cold: ColdStart,
  s: AuditSettings,
): {
  scope: Audit["scope"];
  controls: Control[];
} {
  const now = new Date(e.now);
  const anyCold = [cold.account, cold.pixel, cold.conversion].includes("cold");
  const out: Control[] = [];
  const add = (c: Control) => out.push(c);
  const unknown = (id: string, category: Category, severity: Severity, part: string) =>
    add({ id, category, severity, state: "unknown", detail: `${part} not read` });

  const standing = (rows: { effective_status?: string }[] | null) =>
    (rows ?? []).filter((r) => !GONE.has(r.effective_status ?? ""));
  const liveAdsets = standing(e.adsets).filter((a) => a.effective_status === "ACTIVE");
  const scope: Audit["scope"] = liveAdsets.length > 0 ? "live" : "paused";
  const inScope = <T extends { effective_status?: string }>(rows: T[] | null): T[] =>
    standing(rows).filter((r) => scope === "paused" || r.effective_status === "ACTIVE") as T[];
  const adsets = inScope(e.adsets);
  const adRows = inScope(e.ads);

  // policy
  if (!e.account || e.account.account_status === undefined)
    unknown("policy.account_status", "policy", "critical", "account status");
  else
    add({
      id: "policy.account_status",
      category: "policy",
      severity: "critical",
      state: e.account.account_status === 1 ? "pass" : "fail",
      detail: `account_status ${e.account.account_status} (1 = active)`,
    });
  if (!e.ads) unknown("policy.disapproved", "policy", "high", "ads");
  else {
    const bad = standing(e.ads).filter((a) =>
      ["DISAPPROVED", "WITH_ISSUES"].includes(a.effective_status ?? ""),
    );
    add({
      id: "policy.disapproved",
      category: "policy",
      severity: "high",
      state: standing(e.ads).length === 0 ? "not_applicable" : bad.length ? "fail" : "pass",
      detail: bad.length ? `${bad.length} ads disapproved or with issues` : "no ads flagged",
    });
  }

  // measurement
  const needsPixel = (e.adsets ?? []).some(
    (a) => a.optimization_goal === "OFFSITE_CONVERSIONS" || a.promoted_object?.pixel_id,
  );
  if (!e.pixels || !e.adsets)
    unknown("measurement.pixel", "measurement", "critical", "pixels or ad sets");
  else {
    const usable = e.pixels.filter((p) => !p.is_unavailable);
    add({
      id: "measurement.pixel",
      category: "measurement",
      severity: "critical",
      state: !needsPixel ? "not_applicable" : usable.length ? "pass" : "fail",
      detail: needsPixel
        ? `${usable.length} usable pixels; an ad set optimizes for website events`
        : "no ad set optimizes for website events",
    });
  }
  if (!e.pixels) unknown("measurement.pixel_firing", "measurement", "high", "pixels");
  else {
    const usable = e.pixels.filter((p) => !p.is_unavailable);
    const freshest = Math.min(
      ...usable.map((p) => ageDays(p.last_fired_time, now) ?? Number.POSITIVE_INFINITY),
    );
    add({
      id: "measurement.pixel_firing",
      category: "measurement",
      severity: "high",
      state:
        usable.length === 0 ? "not_applicable" : freshest <= s.pixelStaleDays ? "pass" : "fail",
      detail:
        usable.length === 0
          ? "no pixel"
          : Number.isFinite(freshest)
            ? `last event ${Math.floor(freshest)} days ago`
            : "never fired",
    });
  }
  if (!e.ads) unknown("measurement.utm", "measurement", "medium", "ads");
  else {
    const withCreative = adRows.filter((a) => a.creative);
    const tagged = withCreative.filter((a) => a.creative?.url_tags?.includes("utm_"));
    add({
      id: "measurement.utm",
      category: "measurement",
      severity: "medium",
      state:
        withCreative.length === 0
          ? adRows.length
            ? "unknown"
            : "not_applicable"
          : tagged.length === withCreative.length
            ? "pass"
            : "fail",
      detail: `${tagged.length}/${withCreative.length} ads carry utm tags`,
    });
  }

  // creative
  if (!e.ads) {
    unknown("creative.formats", "creative", "medium", "ads");
    unknown("creative.per_adset", "creative", "high", "ads");
  } else {
    const formats = new Set(adRows.map((a) => a.creative?.object_type).filter(Boolean));
    add({
      id: "creative.formats",
      category: "creative",
      severity: "medium",
      state: adRows.length === 0 ? "not_applicable" : formats.size >= 2 ? "pass" : "fail",
      detail: `formats: ${[...formats].join(", ") || "none read"}`,
    });
    const thin = adsets.filter(
      (set) => adRows.filter((a) => a.adset_id === set.id).length < s.minAdsPerAdset,
    );
    add({
      id: "creative.per_adset",
      category: "creative",
      severity: "high",
      state: adsets.length === 0 ? "not_applicable" : thin.length ? "fail" : "pass",
      detail: `${thin.length}/${adsets.length} ad sets test fewer than ${s.minAdsPerAdset} ads`,
    });
  }

  // structure
  if (!e.campaigns || !e.adsets) {
    unknown("structure.objective_goal", "structure", "high", "campaigns or ad sets");
    unknown("structure.fragmentation", "structure", "medium", "campaigns or ad sets");
  } else {
    const objective = new Map(e.campaigns.map((c) => [c.id, c.objective]));
    if (cold.conversion === "cold")
      add({
        id: "structure.objective_goal",
        category: "structure",
        severity: "high",
        state: "not_applicable",
        detail: "no conversions yet: a click goal is a fair staging step",
      });
    else {
      const judged = adsets.map((a) => {
        const goals = ALIGNED[objective.get(a.campaign_id ?? "") ?? ""];
        return !goals || !a.optimization_goal ? null : goals.includes(a.optimization_goal);
      });
      const off = judged.filter((j) => j === false).length;
      add({
        id: "structure.objective_goal",
        category: "structure",
        severity: "high",
        state:
          adsets.length === 0
            ? "not_applicable"
            : off
              ? "fail"
              : judged.includes(null)
                ? "unknown"
                : "pass",
        detail: `${off}/${adsets.length} ad sets optimize away from their campaign's objective`,
      });
    }
    if (anyCold)
      add({
        id: "structure.fragmentation",
        category: "structure",
        severity: "medium",
        state: "not_applicable",
        detail: "cold start: consolidation rules need history",
      });
    else {
      const per = new Map<string, number>();
      for (const a of adsets) per.set(a.campaign_id ?? "", (per.get(a.campaign_id ?? "") ?? 0) + 1);
      const most = Math.max(0, ...per.values());
      add({
        id: "structure.fragmentation",
        category: "structure",
        severity: "medium",
        state:
          adsets.length === 0 ? "not_applicable" : most > s.maxAdsetsPerCampaign ? "fail" : "pass",
        detail: `at most ${most} ad sets in one campaign (limit ${s.maxAdsetsPerCampaign})`,
      });
    }
  }

  // delivery
  if (!e.adsets) unknown("delivery.learning", "delivery", "high", "ad sets");
  else {
    const live = adsets.filter((a) => a.effective_status === "ACTIVE");
    const failed = live.filter((a) => a.learning_stage_info?.status === "FAIL");
    const read = live.filter((a) => a.learning_stage_info?.status);
    add({
      id: "delivery.learning",
      category: "delivery",
      severity: "high",
      state:
        live.length === 0
          ? "not_applicable"
          : failed.length
            ? "fail"
            : read.length < live.length
              ? "unknown"
              : "pass",
      detail: `${failed.length}/${live.length} live ad sets stuck in learning (learning limited)`,
    });
  }
  if (!e.adsets || !e.recent)
    unknown("delivery.budget_use", "delivery", "medium", "ad sets or insights");
  else {
    const budget =
      adsets
        .filter((a) => a.effective_status === "ACTIVE")
        .reduce((n, a) => n + Number(a.daily_budget ?? 0), 0) / 100;
    const spent = e.recent.reduce((n, r) => n + Number(r.spend ?? 0), 0);
    const use = budget > 0 ? spent / (budget * 7) : null;
    add({
      id: "delivery.budget_use",
      category: "delivery",
      severity: "medium",
      state: use === null ? "not_applicable" : use >= s.minBudgetUse ? "pass" : "fail",
      detail:
        use === null
          ? "no live ad set budget"
          : `spent $${spent.toFixed(2)} of $${(budget * 7).toFixed(2)} over 7 days (${Math.round(use * 100)}%)`,
    });
  }

  return { scope, controls: out };
}

/** Health and coverage per category and overall; absent categories drop out and the rest renormalize. */
export function score(
  cs: Control[],
): Pick<Audit, "categories" | "health" | "coverage" | "grade" | "gaps"> {
  const categories: Audit["categories"] = {};
  let weighted = 0;
  let weights = 0;
  let known = 0;
  let applicable = 0;
  for (const cat of Object.keys(CATEGORY_WEIGHT) as Category[]) {
    const mine = cs.filter((c) => c.category === cat && c.state !== "not_applicable");
    if (mine.length === 0) continue;
    const w = (st: ControlState[]) =>
      mine.filter((c) => st.includes(c.state)).reduce((n, c) => n + WEIGHT[c.severity], 0);
    const pass = w(["pass"]);
    const k = w(["pass", "fail"]);
    const a = w(["pass", "fail", "unknown"]);
    const health = k > 0 ? (100 * pass) / k : null;
    categories[cat] = { health, coverage: a > 0 ? k / a : 0 };
    known += k;
    applicable += a;
    if (health !== null) {
      weighted += CATEGORY_WEIGHT[cat] * health;
      weights += CATEGORY_WEIGHT[cat];
    }
  }
  const coverage = applicable > 0 ? known / applicable : 0;
  return {
    categories,
    health: weights > 0 ? weighted / weights : null,
    coverage,
    grade: coverage >= 0.8 ? "graded" : coverage >= 0.6 ? "provisional" : "insufficient",
    gaps: cs.filter((c) => c.severity === "critical" && c.state === "unknown").map((c) => c.id),
  };
}

const FIX: Record<string, string> = {
  "policy.account_status": "Clear the account's status in Business Support Home before any spend.",
  "policy.disapproved":
    "Read each flagged ad's rejection reason; fix the copy or asset and resubmit.",
  "measurement.pixel":
    "Install the Meta pixel on the landing pages the website-event ad sets send to.",
  "measurement.pixel_firing":
    "Fire a test event (Events Manager → Test events) and check the pixel's site.",
  "measurement.utm":
    "Add url_tags (utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}) to each creative.",
  "creative.formats":
    "Add a second format (video or carousel beside the image) as its own hypothesis.",
  "creative.per_adset":
    "Give each ad set at least the configured number of ads, each testing one hypothesis.",
  "structure.objective_goal": "Match each ad set's optimization goal to its campaign's objective.",
  "structure.fragmentation": "Merge ad sets that share an audience so each exits learning faster.",
  "delivery.learning":
    "Widen the audience or raise the budget on learning-limited ad sets, or merge them.",
  "delivery.budget_use":
    "Budgets go unspent: widen targeting or lower the budget to what delivers.",
};

/** Drafts for every failed control, plus the cold-start plan when any dimension is cold. */
export function drafts(cs: Control[], cold: ColdStart): Draft[] {
  const out: Draft[] = cs
    .filter((c) => c.state === "fail")
    .map((c) => ({ control: c.id, text: FIX[c.id] ?? c.detail }));
  if ([cold.account, cold.pixel, cold.conversion].includes("cold"))
    out.push(
      {
        control: null,
        text: "Cold start: validate measurement first. One test lead or event end to end, seen in Events Manager and in wren.",
      },
      {
        control: null,
        text: "Cold start: write each creative as a hypothesis (audience, pain, proof) and launch two to three side by side.",
      },
      {
        control: null,
        text: "Cold start: stage reversible tests. Launch PAUSED, start at a small daily budget, stop rule set before start. No benchmark verdicts until history exists.",
      },
    );
  return out;
}

export function audit(e: Evidence, s: AuditSettings = auditSettingsSchema.parse({})): Audit {
  const cold = coldStart(e);
  const { scope, controls: cs } = controls(e, cold, s);
  return {
    at: e.now,
    accountId: e.account?.id ?? null,
    coldStart: cold,
    scope,
    controls: cs,
    ...score(cs),
    drafts: drafts(cs, cold),
    errors: e.errors,
  };
}
