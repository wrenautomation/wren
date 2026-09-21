/**
 * The one paid step: an idea in William's words → one draft per platform.
 * The model proposes; the code disposes: a draft over the platform's length,
 * missing a required title, or unparseable is not stored, and the platform's
 * row in the result says why. A platform the idea cannot go to (a Reel with
 * no video) is skipped before any call.
 */
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient, type Tracer } from "@wren/llm";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { PLATFORM_SPECS, type PlatformSpec, unfitReason } from "./platforms.js";
import { type ContentDraft, type ContentIdea, contentDrafts, contentIdeas } from "./schema.js";
import { type Brand, DEFAULT_BRAND, DEFAULT_VOICE } from "./voice.js";

// v1 (2026-09-22): first prompt. Bump when the prompt or the platform shapes change.
export const DRAFT_PROMPT_VERSION = "v1";
export const DRAFT_STAGE = "content_draft";
// The answer is a few hundred tokens; a reasoning model thinks inside the same budget.
const MAX_TOKENS = 4000;
const MAX_IDEA_CHARS = 6000;

const proposal = z.object({
  text: z.string().min(1),
  title: z.string().min(1).optional(),
});
type Proposal = z.infer<typeof proposal>;

export interface DraftOptions {
  voice?: string;
  brand?: Brand;
  tracer?: Tracer | null;
  runId?: string | null;
  /** Draft again for platforms that already have a live draft (default: skip them). */
  again?: boolean;
}

export type DraftResult =
  | { platform: Platform; ok: true; draft: ContentDraft }
  | { platform: Platform; ok: false; reason: string };

export function draftPrompt(
  idea: Pick<ContentIdea, "text" | "media">,
  spec: PlatformSpec,
  o: { voice: string; brand: Brand },
): string {
  const media = idea.media
    ? `\nThe post carries a ${idea.media.kind}${idea.media.title ? `: "${idea.media.title}"` : ""}. Write for someone who will watch or look at it.`
    : "";
  const answer = spec.title
    ? `{"title": "<the title>", "text": "<the description>"}`
    : `{"text": "<the post>"}`;
  return `You write social posts for ${o.brand.name}, ${o.brand.about}.
Write in this voice:
${o.voice}

Write ${spec.shape}. Stay inside ${spec.maxChars} characters.${spec.title ? ` The title stays inside ${spec.title.maxChars} characters.` : ""}
Use only what the idea says; invent no numbers, names or events. Keep the author's wording where it already reads well.
${media}
The idea, in the author's own words:
"""
${idea.text.slice(0, MAX_IDEA_CHARS)}
"""

Answer with JSON only, nothing before or after: ${answer}`;
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
    const outcome = await completeAndParse(
      llm,
      draftPrompt(idea, spec, { voice, brand }),
      proposal,
      {
        maxTokens: MAX_TOKENS,
        runId: o.runId ?? null,
        tracer: o.tracer ?? null,
        name: DRAFT_STAGE,
        metadata: { platform, ideaId: idea.id, version: DRAFT_PROMPT_VERSION },
      },
    );
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
        llm: outcome.envelope(),
      })
      .returning();
    if (!draft) throw new Error("insert returned no row");
    results.push({ platform, ok: true, draft });
  }
  if (results.some((r) => r.ok) && idea.status === "open")
    await db.update(contentIdeas).set({ status: "drafted" }).where(eq(contentIdeas.id, idea.id));
  return results;
}
