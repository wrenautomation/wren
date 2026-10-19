/**
 * The client-zero seed (designs/2026-10-18-journeys.md, "Client zero"): one JSON file holds
 * Wren's funnels, terms, partner journeys and deal signs. The file is private; this code holds no
 * value. Every write goes through the version store and the `Journeys` service path, so there is
 * no second write path. `planSeed` reads only and finds every problem; `applySeed` runs the plan.
 * Run again, it adds nothing.
 */
import { resolveProfile } from "@wren/core/profiles";
import { atomic, type Queryable } from "@wren/db";
import type { Terms } from "@wren/offers";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { checkFunnel, ENTRY_KINDS, type FunnelBody, RESEARCH_LEVELS } from "./model.js";
import { personByKey, signDeal } from "./moves.js";
import { funnels, funnelVersions, journeys, pipelineDeals, termsVersions } from "./schema.js";
import {
  addFunnel,
  addTerms,
  appendFunnel,
  canonicalJson,
  funnelContext,
  offerVersionsOf,
  Refused,
  setFunnelStatus,
  termsHistory,
  termsProblems,
} from "./store.js";

/** A field the file still needs from a person. The seed refuses a file that holds one. */
export const ASK = "ASK_WILLIAM";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const cents = z.number().int().nonnegative();
const text = z.string().min(1);

const advance = z.strictObject({
  trigger: text,
  with: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
const stage = z.strictObject({
  key: text,
  label: text,
  sale: z.literal(true).optional(),
  on: z.array(advance),
  research: z.enum(RESEARCH_LEVELS).optional(),
  // The range is checkFunnel's, so a bad one gets its plain sentence.
  idleDays: z.number().optional(),
});
const entry = z.strictObject({
  id: text,
  kind: z.enum(ENTRY_KINDS),
  channel: text.optional(),
  campaign: text.optional(),
  funnel: z.strictObject({ id: text, at: text.optional() }).optional(),
  source: text.optional(),
  group: text.optional(),
  to: text.optional(),
});
const funnelBody = z.strictObject({
  name: text,
  offer: text,
  stages: z.array(stage),
  entries: z.array(entry),
});
const termsBody = z.strictObject({
  currency: z.string(),
  setupCents: cents,
  monthlyCents: cents.nullable(),
  perUnitCents: cents.nullable(),
  unit: z.string().nullable(),
  capCents: cents.nullable(),
  days: z.number().int().positive().nullable(),
  until: z.number().int().positive().nullable().optional(),
  refundIfNone: z
    .strictObject({ minContacts: z.number().int().nonnegative() })
    .nullable()
    .optional(),
  payDays: z.number().int(),
  shareBps: z.number().int().nullable().optional(),
  floorCents: cents.nullable().optional(),
  installments: z
    .strictObject({ count: z.number().int(), everyDays: z.number().int() })
    .nullable()
    .optional(),
  trialDays: z.number().int().nullable().optional(),
});

const SeedFile = z.strictObject({
  /** Notes for the reader of the file. Never read by code. */
  note: z.string().optional(),
  /** The registry offer every funnel sells and every plan prices. */
  offer: text,
  funnels: z.array(
    z.strictObject({
      id: text,
      name: text.optional(),
      why: text.optional(),
      status: z.enum(["live", "off"]).default("live"),
      body: funnelBody,
    }),
  ),
  terms: z.array(z.strictObject({ plan: text, from: day, why: text.optional(), body: termsBody })),
  journeys: z.array(
    z.strictObject({
      /** A profile id, an email, a +phone or kind:value. An email that is new makes a profile. */
      person: text,
      name: text.optional(),
      funnel: text,
      at: text,
      entry: text.optional(),
      /** The operator the journey names. Default: whoever runs the seed. */
      by: text.optional(),
    }),
  ),
  deals: z.array(
    z.strictObject({
      person: text,
      funnel: text,
      plan: text,
      /** The `delivery.engagements` row the deal links, found by client and the file's offer. */
      engagement: z.strictObject({ client: text }).optional(),
    }),
  ),
});
export type SeedFile = z.infer<typeof SeedFile>;

/** Where `ASK_WILLIAM` is in a JSON value, as paths like `terms[1].body.shareBps`. */
export function askPaths(v: unknown, path = ""): string[] {
  if (typeof v === "string") return v.includes(ASK) ? [path || "(file)"] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => askPaths(x, `${path}[${i}]`));
  if (v && typeof v === "object")
    return Object.entries(v).flatMap(([k, x]) => [
      ...(k.includes(ASK) ? [`${path}.${k}`] : []),
      ...askPaths(x, path ? `${path}.${k}` : k),
    ]);
  return [];
}

/** Read the whole file or refuse with every reason. Nothing is written. */
export function parseSeed(raw: unknown): SeedFile {
  const asks = askPaths(raw);
  if (asks.length)
    throw new Refused([
      `The file still needs ${asks.length} value${asks.length === 1 ? "" : "s"} from a person:`,
      ...asks.map((p) => `  ${p}`),
    ]);
  const r = SeedFile.safeParse(raw);
  if (!r.success)
    throw new Refused(r.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`));
  const errors: string[] = [];
  const dup = (what: string, keys: string[]) => {
    for (const [i, k] of keys.entries())
      if (keys.indexOf(k) !== i) errors.push(`${what} "${k}" is in the file twice.`);
  };
  dup(
    "Funnel",
    r.data.funnels.map((f) => f.id),
  );
  dup(
    "Plan",
    r.data.terms.map((t) => t.plan),
  );
  dup(
    "Journey",
    r.data.journeys.map((j) => `${j.person} in ${j.funnel}`),
  );
  dup(
    "Deal",
    r.data.deals.map((d) => `${d.person} in ${d.funnel}`),
  );
  if (errors.length) throw new Refused(errors);
  return r.data;
}

export interface SeedDeps {
  db: Queryable;
  /** Who the writes name. */
  by: string;
  /** Trigger component ids that exist. */
  triggers: ReadonlySet<string>;
  /** The `Journeys` service's open. A refusal throws `Refused`. */
  open(req: {
    funnel: string;
    person: string;
    at: string;
    entry?: string;
    by: string;
  }): Promise<unknown>;
  /** The ids of `delivery.engagements` rows of this client and offer. */
  engagements(q: { client: string; offer: string }): Promise<number[]>;
  now?: Date;
  /** Pause between looks for a deal the funnel is still making. */
  wait?(ms: number): Promise<void>;
}

export type Area = "funnel" | "status" | "terms" | "journey" | "deal" | "engagement";
export interface PlanItem {
  area: Area;
  key: string;
  do: "add" | "append" | "set" | "open" | "sign" | "link" | "skip";
  note?: string;
  /** Performs the item. Absent for a skip. */
  run?: () => Promise<void>;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const isEmail = (k: string) => k.includes("@") && !k.startsWith("handle:");
const entryStages = (b: FunnelBody) =>
  new Set(b.entries.map((e) => e.to ?? b.stages[0]?.key).filter((k): k is string => !!k));

/** What the file would do now. Reads only; refuses with every problem found. */
export async function planSeed(deps: SeedDeps, seed: SeedFile): Promise<PlanItem[]> {
  const { db } = deps;
  const today = (deps.now ?? new Date()).toISOString().slice(0, 10);
  const errors: string[] = [];
  const items: PlanItem[] = [];
  const bad = (m: string) => void errors.push(m);

  if (!(await offerVersionsOf(db, seed.offer)).length)
    bad(`No stored version of offer "${seed.offer}". Run \`wren offers sync\` first.`);

  // Funnels: what each one's body and status will be after the run.
  const bodies = new Map<string, FunnelBody>();
  const statuses = new Map<string, "live" | "off">();
  for (const f of seed.funnels) {
    const body = f.body as FunnelBody;
    if (body.offer !== seed.offer)
      bad(`Funnel ${f.id} sells "${body.offer}", not the file's offer "${seed.offer}".`);
    const [last] = await db
      .select({ number: funnelVersions.number, body: funnelVersions.body })
      .from(funnelVersions)
      .where(eq(funnelVersions.funnel, f.id))
      .orderBy(desc(funnelVersions.number))
      .limit(1);
    const [head] = await db
      .select({ status: funnels.status })
      .from(funnels)
      .where(eq(funnels.id, f.id));
    bodies.set(f.id, body);
    statuses.set(f.id, f.status);
    const why = f.why ?? "client-zero seed";
    if (last && same(last.body, body)) {
      items.push({ area: "funnel", key: f.id, do: "skip", note: `already v${last.number}` });
    } else {
      const found = checkFunnel(
        last?.body ?? null,
        body,
        await funnelContext(db, f.id, deps.triggers),
      );
      for (const m of found) bad(`Funnel ${f.id}: ${m}`);
      items.push({
        area: "funnel",
        key: f.id,
        do: last ? "append" : "add",
        note: `v${(last?.number ?? 0) + 1}, ${body.stages.length} stages`,
        run: async () => {
          if (last) await appendFunnel(db, f.id, body, why, deps.by, deps.triggers);
          else
            await addFunnel(db, {
              id: f.id,
              name: f.name ?? body.name,
              body,
              why,
              by: deps.by,
              triggers: deps.triggers,
            });
        },
      });
    }
    if ((head?.status ?? "live") !== f.status)
      items.push({
        area: "status",
        key: f.id,
        do: "set",
        note: f.status,
        run: async () => void (await setFunnelStatus(db, f.id, f.status)),
      });
    else items.push({ area: "status", key: f.id, do: "skip", note: f.status });
  }

  // Terms: a plan gets a new version only when its body changed.
  const plans = new Map<string, Terms>();
  for (const t of seed.terms) {
    const body = t.body as Terms;
    for (const m of termsProblems(body)) bad(`Plan ${t.plan}: ${m}`);
    const [last] = (await termsHistory(db, seed.offer, t.plan)).slice(-1);
    if (last && same(last.body, body)) {
      items.push({ area: "terms", key: t.plan, do: "skip", note: `already v${last.number}` });
      plans.set(t.plan, body);
      continue;
    }
    if (last && t.from < last.effectiveFrom)
      bad(
        `Plan ${t.plan}: v${last.number} starts ${last.effectiveFrom}. A new version cannot start earlier.`,
      );
    if (t.from <= today) plans.set(t.plan, body);
    items.push({
      area: "terms",
      key: t.plan,
      do: "add",
      note: `v${(last?.number ?? 0) + 1} from ${t.from}`,
      run: async () => {
        await addTerms(db, {
          offer: seed.offer,
          plan: t.plan,
          from: t.from,
          body,
          why: t.why ?? "client-zero seed",
          by: deps.by,
        });
      },
    });
  }

  // Journeys.
  for (const j of seed.journeys) {
    const key = `${j.person} in ${j.funnel}`;
    const status = statuses.get(j.funnel);
    let body = bodies.get(j.funnel);
    if (!body) {
      const [last] = await db
        .select({ body: funnelVersions.body })
        .from(funnelVersions)
        .where(eq(funnelVersions.funnel, j.funnel))
        .orderBy(desc(funnelVersions.number))
        .limit(1);
      body = last?.body;
      if (!body) {
        bad(`Journey ${key}: no funnel ${j.funnel}.`);
        continue;
      }
      const [head] = await db
        .select({ status: funnels.status })
        .from(funnels)
        .where(eq(funnels.id, j.funnel));
      if (head?.status === "off") bad(`Journey ${key}: funnel ${j.funnel} is off.`);
    } else if (status === "off") bad(`Journey ${key}: funnel ${j.funnel} is off in the file.`);
    if (!entryStages(body).has(j.at))
      bad(`Journey ${key}: "${j.at}" is not an entry stage of ${j.funnel}.`);
    if (j.entry && !body.entries.some((e) => e.id === j.entry))
      bad(`Journey ${key}: ${j.funnel} has no entry "${j.entry}".`);
    const profile = await personByKey(db, j.person);
    if (profile === null && !isEmail(j.person)) {
      bad(`Journey ${key}: no profile for that key, and only an email makes one.`);
      continue;
    }
    const had =
      profile === null
        ? undefined
        : (
            await db
              .select({ stage: journeys.stage, status: journeys.status })
              .from(journeys)
              .where(and(eq(journeys.profileId, profile), eq(journeys.funnel, j.funnel)))
              .limit(1)
          )[0];
    if (had) {
      items.push({ area: "journey", key, do: "skip", note: `${had.status} at ${had.stage}` });
      continue;
    }
    items.push({
      area: "journey",
      key,
      do: "open",
      note: `at ${j.at}${profile === null ? ", new profile" : ""}`,
      run: async () => {
        if (profile === null)
          await resolveProfile(db, [{ kind: "email", value: j.person }], "seed", {
            ...(j.name ? { name: j.name } : {}),
          });
        await deps.open({
          funnel: j.funnel,
          person: j.person,
          at: j.at,
          ...(j.entry ? { entry: j.entry } : {}),
          by: j.by ?? deps.by,
        });
      },
    });
  }

  // Deals: sign the plan, link the engagement. Terms are set once; the seed never forces.
  for (const d of seed.deals) {
    const key = `${d.person} in ${d.funnel}`;
    if (!seed.journeys.some((j) => j.person === d.person && j.funnel === d.funnel))
      bad(`Deal ${key}: the file has no such journey.`);
    const want = plans.get(d.plan);
    if (!want) bad(`Deal ${key}: plan ${d.plan} has no terms live today.`);
    let engagement: number | null = null;
    if (d.engagement) {
      const ids = await deps.engagements({ client: d.engagement.client, offer: seed.offer });
      if (ids.length !== 1)
        bad(
          `Deal ${key}: ${ids.length} engagements of ${d.engagement.client} for ${seed.offer}. The link needs exactly one.`,
        );
      else engagement = ids[0] ?? null;
    }
    const profile = await personByKey(db, d.person);
    const [row] =
      profile === null
        ? []
        : await db
            .select({
              id: pipelineDeals.id,
              terms: pipelineDeals.termsVersion,
              engagement: pipelineDeals.engagementId,
            })
            .from(pipelineDeals)
            .innerJoin(journeys, eq(journeys.id, pipelineDeals.journey))
            .where(and(eq(journeys.profileId, profile), eq(journeys.funnel, d.funnel)));
    let signed = false;
    if (row?.terms != null) {
      const [t] = await db
        .select({ body: termsVersions.body })
        .from(termsVersions)
        .where(eq(termsVersions.id, row.terms));
      if (want && t && !same(t.body, want))
        bad(
          `Deal ${key}: its terms are set and differ from plan ${d.plan}. The seed never changes them.`,
        );
      else signed = true;
    }
    if (row?.engagement != null && engagement !== null && row.engagement !== engagement)
      bad(`Deal ${key}: it links engagement ${row.engagement}, not ${engagement}.`);
    items.push(
      signed
        ? { area: "deal", key, do: "skip", note: `signed on ${d.plan}` }
        : {
            area: "deal",
            key,
            do: "sign",
            note: d.plan,
            run: async () => {
              const id = await dealOf(deps, d.person, d.funnel);
              await signDeal(db, { deal: id, plan: d.plan, now: deps.now ?? new Date() });
            },
          },
    );
    if (d.engagement) {
      if (row?.engagement != null)
        items.push({ area: "engagement", key, do: "skip", note: `linked to ${row.engagement}` });
      else
        items.push({
          area: "engagement",
          key,
          do: "link",
          note: `engagement ${engagement}`,
          run: async () => {
            if (engagement === null) throw new Refused(["No engagement to link."]);
            await linkEngagement(db, await dealOf(deps, d.person, d.funnel), engagement);
          },
        });
    }
  }

  if (errors.length) throw new Refused(errors);
  return items;
}

/** The deal of a person's journey. The funnel makes it as the journey reaches the sale stage. */
async function dealOf(deps: SeedDeps, person: string, funnel: string): Promise<string> {
  const profile = await personByKey(deps.db, person);
  if (profile === null) throw new Refused([`No profile for ${person}.`]);
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < 20; i++) {
    const [d] = await deps.db
      .select({ id: pipelineDeals.id })
      .from(pipelineDeals)
      .innerJoin(journeys, eq(journeys.id, pipelineDeals.journey))
      .where(and(eq(journeys.profileId, profile), eq(journeys.funnel, funnel)));
    if (d) return d.id;
    await wait(250);
  }
  throw new Refused([
    `${person} has no deal in ${funnel}. Is the journey at the sale stage? Run again.`,
  ]);
}

/** Link a deal to its engagement once. A different link is refused. */
export async function linkEngagement(
  db: Queryable,
  deal: string,
  engagement: number,
): Promise<void> {
  await atomic(db, async (tx) => {
    const [d] = await tx
      .select({ engagement: pipelineDeals.engagementId })
      .from(pipelineDeals)
      .where(eq(pipelineDeals.id, deal))
      .for("update");
    if (!d) throw new Refused([`No deal ${deal}.`]);
    if (d.engagement === engagement) return;
    if (d.engagement !== null)
      throw new Refused([`Deal ${deal} already links engagement ${d.engagement}.`]);
    await tx
      .update(pipelineDeals)
      .set({ engagementId: engagement })
      .where(eq(pipelineDeals.id, deal));
  });
}

/** Run a plan in order: funnels, terms, journeys, deals. */
export async function applySeed(items: readonly PlanItem[]): Promise<void> {
  for (const i of items) await i.run?.();
}
