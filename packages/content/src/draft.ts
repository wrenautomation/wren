/**
 * The one paid step: an idea in William's words → one draft per platform.
 * The model proposes; the code disposes: a draft over the platform's length,
 * missing a required title, or unparseable is not stored, and the platform's
 * row in the result says why. A platform the idea cannot go to (a Reel with
 * no video) is skipped before any call. The facts guard (`@wren/core/grounded`)
 * checks every draft against the idea (his words) and the facts: a made-up
 * claim or number is asked for once more, then the platform's row says why.
 */
import type { Platform } from "@wren/core/content";
import { llmOf, recordDraft } from "@wren/core/draft-record";
import { droppedWhy, guardDraft, recordGuard } from "@wren/core/grounded";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, type Outcome, type Tracer } from "@wren/llm";
import { and, count, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { type Lessons, lessonsBlock, lessonsFor, NO_LESSONS } from "./lessons.js";
import { PLATFORM_SPECS, type PlatformSpec, unfitReason } from "./platforms.js";
import { playbookBlock, playbookFor } from "./playbook.js";
import {
  type ContentDraft,
  type ContentIdea,
  type ContentPlaybook,
  contentDrafts,
  contentIdeas,
} from "./schema.js";
import { type Brand, DEFAULT_BRAND, DEFAULT_VOICE } from "./voice.js";

// v1 (2026-09-22): first prompt. v3 (2026-10-04): the platform's playbook. v4 (2026-10-07): the
// facts rule and guard. Bump when the prompt or the platform shapes change.
export const DRAFT_PROMPT_VERSION = "v4";
export const DRAFT_STAGE = "content_draft";
// The answer is a few hundred tokens; a reasoning model thinks inside the same budget.
const MAX_TOKENS = 4000;
const MAX_IDEA_CHARS = 6000;

const proposal = z.object({
  text: z.string().min(1),
  title: z.string().min(1).optional(),
});
export type Proposal = z.infer<typeof proposal>;

export interface DraftOptions {
  /** Who asked (his email): a redraft's record says whose note it was. */
  by?: string | null;
  voice?: string;
  brand?: Brand;
  tracer?: Tracer | null;
  runId?: string | null;
  /** Draft again for platforms that already have a live draft (default: skip them). */
  again?: boolean;
  /** What is true about the author beyond the idea (`wrenFacts`); claims may come from these too. */
  facts?: readonly string[];
}

export type DraftResult =
  | { platform: Platform; ok: true; draft: ContentDraft }
  | { platform: Platform; ok: false; reason: string };

export function draftPrompt(
  idea: Pick<ContentIdea, "text" | "media">,
  spec: PlatformSpec,
  o: {
    voice: string;
    brand: Brand;
    lessons?: Lessons;
    playbook?: Pick<ContentPlaybook, "text"> | null;
    facts?: readonly string[];
  },
): string {
  const facts = o.facts?.length
    ? `\nBesides the idea, what is true about the author:\n${o.facts.map((f) => `- ${f}`).join("\n")}`
    : "";
  const media = idea.media
    ? `\nThe post carries a ${idea.media.kind}${idea.media.title ? `: "${idea.media.title}"` : ""}. Write for someone who will watch or look at it.`
    : "";
  const answer = spec.title
    ? `{"title": "<the title>", "text": "<the description>"}`
    : `{"text": "<the post>"}`;
  return `You write social posts for ${o.brand.name}, ${o.brand.about}.
Write in this voice:
${o.voice}
${playbookBlock(o.playbook ?? null)}
Write ${spec.shape}. Stay inside ${spec.maxChars} characters.${spec.title ? ` The title stays inside ${spec.title.maxChars} characters.` : ""}
Use only what the idea says; invent no numbers, names or events. Claim no experience, client or result the idea${facts ? " or the facts below" : ""} doesn't give. Keep the author's wording where it already reads well.${facts}
${media}${lessonsBlock(o.lessons ?? NO_LESSONS)}
The idea, in the author's own words:
"""
${idea.text.slice(0, MAX_IDEA_CHARS)}
"""

Answer with JSON only, nothing before or after: ${answer}`;
}

/** The same ask with the last draft and the person's note: rewrite, do not start over. */
export function redraftPrompt(
  idea: Pick<ContentIdea, "text" | "media">,
  spec: PlatformSpec,
  previous: { text: string; title: string | null },
  note: string,
  o: {
    voice: string;
    brand: Brand;
    lessons?: Lessons;
    playbook?: Pick<ContentPlaybook, "text"> | null;
    facts?: readonly string[];
  },
): string {
  const base = draftPrompt(idea, spec, o);
  const cut = base.lastIndexOf("\nAnswer with JSON only");
  const head = cut >= 0 ? base.slice(0, cut) : base;
  const tail = cut >= 0 ? base.slice(cut) : "";
  return `${head}
The previous draft${previous.title ? ` (title: "${previous.title}")` : ""}:
"""
${previous.text}
"""

The author read it and says: "${note.trim().slice(0, 1000)}"
Rewrite the draft to do what the author says and keep everything else that worked.
${tail}`;
}

/**
 * Ask for one post, guarded: his idea (and his note) back claims and numbers, as do the facts. A
 * flag asks once more with what was flagged; flagged again, `why` says what was made up. A guard
 * hit is a `runs` row.
 */
export async function askGuarded(
  db: Queryable,
  llm: LlmClient,
  prompt: string,
  own: readonly string[],
  o: Pick<DraftOptions, "runId" | "tracer" | "facts"> & {
    item: string;
    metadata: Record<string, unknown>;
  },
): Promise<{ outcome: Outcome<Proposal>; why: string | null }> {
  const g = await guardDraft(
    async (fix) => {
      const outcome = await completeAndParse(llm, fix ? `${prompt}\n\n${fix}` : prompt, proposal, {
        maxTokens: MAX_TOKENS,
        runId: o.runId ?? null,
        tracer: o.tracer ?? null,
        name: DRAFT_STAGE,
        metadata: o.metadata,
      });
      const p = outcome.parsed;
      return { text: p ? [p.title ?? "", p.text].join("\n").trim() : "", result: outcome };
    },
    { facts: o.facts ?? [], sources: [], own },
  );
  await recordGuard(db, DRAFT_STAGE, o.item, g);
  return { outcome: g.result, why: g.text === null ? droppedWhy(g) : null };
}

/** A model's post in the draft record: its words and what it was asked (a redraft: at his note). */
export async function keepGenerated(
  db: Queryable,
  llm: LlmClient,
  d: ContentDraft,
  outcome: Outcome<Proposal>,
  o: { ask?: string; by: string | null | undefined },
) {
  await recordDraft(db, {
    item: `draft:${d.id}`,
    kind: "post",
    platform: d.platform,
    event: "generated",
    via: "model",
    by: llm.name,
    text: d.text,
    title: d.title,
    ask: o.ask ?? null,
    llm: llmOf(outcome, DRAFT_STAGE, { version: d.promptVersion, asked_by: o.by ?? null }),
    meta: {
      idea: d.ideaId,
      ...(d.redraftOf ? { redraft_of: d.redraftOf } : {}),
      ...(d.playbookId ? { playbook: d.playbookId } : {}),
    },
    runId: outcome.call?.run_id ?? null,
  });
}

/** The deterministic gate: why the proposal cannot be stored, or null. */
export function unfitProposal(spec: PlatformSpec, p: Proposal): string | null {
  const text = p.text.trim();
  if (text.length === 0) return "empty text";
  if (text.length > spec.maxChars) return `text is ${text.length} chars, over ${spec.maxChars}`;
  if (spec.title) {
    const title = p.title?.trim() ?? "";
    if (title.length === 0) return "no title";
    if (title.length > spec.title.maxChars)
      return `title is ${title.length} chars, over ${spec.title.maxChars}`;
  }
  return null;
}

/** Platforms with a draft that is not rejected: drafting them again needs `again`. */
async function livePlatforms(db: Queryable, ideaId: string): Promise<Set<Platform>> {
  const rows = await db
    .select({ platform: contentDrafts.platform })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.ideaId, ideaId),
        inArray(contentDrafts.status, ["draft", "approved", "publishing", "published"]),
      ),
    );
  return new Set(rows.map((r) => r.platform));
}

/** Redrafts one slot takes in a day (O5: Cohere is free, his review time is not). */
export const MAX_SLOT_REDRAFTS = 2;

/** Redrafts made in the last 24 hours for the slot `d` holds on its platform, superseded ones too. */
async function slotRedrafts(
  db: Queryable,
  d: Pick<ContentDraft, "platform" | "scheduledFor">,
): Promise<number> {
  if (!d.scheduledFor) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.platform, d.platform),
        eq(contentDrafts.scheduledFor, d.scheduledFor),
        isNotNull(contentDrafts.redraftOf),
        gte(contentDrafts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  return row?.n ?? 0;
}

/**
 * One more paid step for one draft: the previous text plus the person's
 * note → a new row (the old one is rejected as superseded). Same gate.
 */
export async function redraft(
  db: Queryable,
  llm: LlmClient,
  previous: ContentDraft,
  idea: Pick<ContentIdea, "text" | "media">,
  note: string,
  o: Omit<DraftOptions, "again"> = {},
): Promise<DraftResult> {
  const platform = previous.platform;
  const spec = PLATFORM_SPECS[platform];
  if (note.trim() === "") return { platform, ok: false, reason: "empty note" };
  if (!["draft", "approved", "failed"].includes(previous.status))
    return { platform, ok: false, reason: `cannot redraft a ${previous.status} draft` };
  // A row read through a journaled step arrives with its dates as strings.
  const slot = previous.scheduledFor ? new Date(previous.scheduledFor) : null;
  if (slot && (await slotRedrafts(db, { platform, scheduledFor: slot })) >= MAX_SLOT_REDRAFTS)
    return {
      platform,
      ok: false,
      reason: `${MAX_SLOT_REDRAFTS} redrafts for this slot today; edit it by hand`,
    };
  const playbook = await playbookFor(db, platform);
  const prompt = redraftPrompt(idea, spec, { text: previous.text, title: previous.title }, note, {
    voice: o.voice ?? DEFAULT_VOICE,
    brand: o.brand ?? DEFAULT_BRAND,
    lessons: await lessonsFor(db, platform),
    playbook,
    ...(o.facts ? { facts: o.facts } : {}),
  });
  const { outcome, why } = await askGuarded(db, llm, prompt, [idea.text, note], {
    ...o,
    item: `draft:${previous.id}`,
    metadata: {
      platform,
      ideaId: previous.ideaId,
      redraftOf: previous.id,
      version: DRAFT_PROMPT_VERSION,
    },
  });
  if (why) return { platform, ok: false, reason: why };
  if (!outcome.parsed)
    return {
      platform,
      ok: false,
      reason: outcome.providerRejected ?? outcome.parseError ?? "no answer",
    };
  const bad = unfitProposal(spec, outcome.parsed);
  if (bad) return { platform, ok: false, reason: bad };
  const [draft] = await db
    .insert(contentDrafts)
    .values({
      ideaId: previous.ideaId,
      platform,
      text: outcome.parsed.text.trim(),
      title: spec.title ? (outcome.parsed.title?.trim() ?? null) : null,
      media: previous.media,
      extra: previous.extra,
      // Where it sits in the funnel and where it points: unchanged by new words.
      stage: previous.stage,
      pointsTo: previous.pointsTo,
      videoDraft: previous.videoDraft,
      linked: previous.linked,
      // The slot the old row held (a planner draft's); inert until approved.
      scheduledFor: slot,
      redraftOf: previous.id,
      note: note.trim(),
      promptVersion: DRAFT_PROMPT_VERSION,
      playbookId: playbook?.id ?? null,
      llm: outcome.envelope(),
    })
    .returning();
  if (!draft) throw new Error("insert returned no row");
  // Superseded, it keeps the slot it held so the slot's redrafts stay countable; a rejected row holds nothing.
  await db
    .update(contentDrafts)
    .set({ status: "rejected" })
    .where(eq(contentDrafts.id, previous.id));
  await keepGenerated(db, llm, draft, outcome, { ask: note.trim(), by: o.by });
  await recordDraft(db, {
    item: `draft:${previous.id}`,
    kind: "post",
    platform,
    event: "rejected",
    via: "person",
    by: o.by ?? null,
    note: note.trim(),
    meta: { redrafted_as: draft.id },
  });
  return { platform, ok: true, draft };
}

export async function draftIdea(
  db: Queryable,
  llm: LlmClient,
  idea: ContentIdea,
  platforms: readonly Platform[],
  o: DraftOptions = {},
): Promise<DraftResult[]> {
  const voice = o.voice ?? DEFAULT_VOICE;
  const brand = o.brand ?? DEFAULT_BRAND;
  const live = o.again ? new Set<Platform>() : await livePlatforms(db, idea.id);
  const results: DraftResult[] = [];
  for (const platform of platforms) {
    const spec = PLATFORM_SPECS[platform];
    if (live.has(platform)) {
      results.push({ platform, ok: false, reason: "already drafted (use again)" });
      continue;
    }
    const unfit = unfitReason(spec, idea.media);
    if (unfit) {
      results.push({ platform, ok: false, reason: unfit });
      continue;
    }
    const playbook = await playbookFor(db, platform);
    const prompt = draftPrompt(idea, spec, {
      voice,
      brand,
      lessons: await lessonsFor(db, platform),
      playbook,
      ...(o.facts ? { facts: o.facts } : {}),
    });
    const { outcome, why } = await askGuarded(db, llm, prompt, [idea.text], {
      ...o,
      item: `idea:${idea.id}/${platform}`,
      metadata: { platform, ideaId: idea.id, version: DRAFT_PROMPT_VERSION },
    });
    if (why) {
      results.push({ platform, ok: false, reason: why });
      continue;
    }
    if (!outcome.parsed) {
      results.push({
        platform,
        ok: false,
        reason: outcome.providerRejected ?? outcome.parseError ?? "no answer",
      });
      continue;
    }
    const bad = unfitProposal(spec, outcome.parsed);
    if (bad) {
      results.push({ platform, ok: false, reason: bad });
      continue;
    }
    const [draft] = await db
      .insert(contentDrafts)
      .values({
        ideaId: idea.id,
        platform,
        text: outcome.parsed.text.trim(),
        title: spec.title ? (outcome.parsed.title?.trim() ?? null) : null,
        media: idea.media,
        promptVersion: DRAFT_PROMPT_VERSION,
        playbookId: playbook?.id ?? null,
        llm: outcome.envelope(),
      })
      .returning();
    if (!draft) throw new Error("insert returned no row");
    await keepGenerated(db, llm, draft, outcome, { by: null });
    results.push({ platform, ok: true, draft });
  }
  if (results.some((r) => r.ok) && idea.status === "open")
    await db.update(contentIdeas).set({ status: "drafted" }).where(eq(contentIdeas.id, idea.id));
  return results;
}
