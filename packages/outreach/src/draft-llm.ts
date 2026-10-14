/**
 * The model that drafts for reach, split by arm (designs/2026-10-14-draft-models.md). The worker
 * hands the drafting code an `ArmedLlm`: any call that isn't a draft (ranking, topics, reading a
 * place) still goes to its base, the Monitor's model; a draft asks `modelFor(llm, item)` and
 * gets the arm that item's id hashes to under the saved `drafts.model` setting.
 */
import { armOf, type DraftArm, draftArms } from "@wren/core/draft-models";
import type { Queryable } from "@wren/db";
import type { CompleteOptions, LlmClient, LlmResponse } from "@wren/llm";

/** The model an item is drafted by, and the arm's spec to keep on its `generated` step. */
export interface Picked {
  llm: LlmClient;
  arm: string | null;
}

export class ArmedLlm implements LlmClient {
  readonly name: string;
  readonly provider: string;
  constructor(
    private readonly base: LlmClient,
    private readonly arms: () => Promise<readonly DraftArm[]>,
    /** A model spec as a client, or null when it can't be built (no keys here). Cached by the caller. */
    private readonly client: (model: string) => LlmClient | null,
  ) {
    this.name = base.name;
    this.provider = base.provider;
  }

  complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse> {
    return this.base.complete(prompt, opts);
  }

  /** The item's arm among those that can be built here; none can, and the base drafts it. */
  async forItem(item: string): Promise<Picked> {
    const usable = (await this.arms()).filter((a) => this.client(a.model));
    if (!usable.length) return { llm: this.base, arm: null };
    const arm = armOf(item, usable);
    const llm = this.client(arm.model);
    return llm ? { llm, arm: arm.model } : { llm: this.base, arm: null };
  }
}

/** A draft's model: its arm when `llm` is armed, else `llm` itself (a client's own model). */
export async function modelFor(llm: LlmClient, item: string): Promise<Picked> {
  return llm instanceof ArmedLlm ? llm.forItem(item) : { llm, arm: null };
}

/** The step's `meta` for a draft written by an arm: which one, so the scorecard can read it. */
export const armMeta = (arm: string | null): Record<string, unknown> => (arm ? { arm } : {});

/** What a guard run keeps as its model: only an arm's, so the scorecard counts the test alone. */
export const guardBy = (p: Picked): string | null => (p.arm ? p.llm.name : null);

/** The saved arms as the worker reads them each draft (settings are one small table). */
export const savedArms = (db: Queryable) => () => draftArms(db);
