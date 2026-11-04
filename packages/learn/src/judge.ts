/**
 * Who breaks an item down: Wren on its own model; a client on the same model, gated and metered on
 * its `models` allowance, or on its own key. `wait` says why it can't now: the item waits.
 */
import { WREN } from "@wren/core/access";
import { findClient } from "@wren/core/clients";
import type { KeyStore } from "@wren/core/keys";
import { meteredModel } from "@wren/core/metered";
import { gate } from "@wren/core/vendors";
import type { Db } from "@wren/db";
import { type LlmClient, llmForKey } from "@wren/llm";

export interface Judge {
  name: string;
  wren: boolean;
  llm: LlmClient | null;
  wait?: string | null;
}
export type JudgeFor = (client: string) => Promise<Judge>;

/** The judge for each workspace. */
export function judges(o: {
  db: Db;
  llm: LlmClient | null;
  now?: () => Date;
  /** Clients' own keys: a client on its own model key reads on it. */
  keys?: KeyStore | null;
}): JudgeFor {
  const now = o.now ?? (() => new Date());
  return async (client) => {
    if (client === WREN) return { name: "Wren", wren: true, llm: o.llm };
    const row = await findClient(o.db, client);
    const base = { name: row?.name ?? client, wren: false };
    if (!row) return { ...base, llm: null, wait: "no such client" };
    if (!o.llm) return { ...base, llm: null };
    const g = await gate(o.db, client, "models", 1, now());
    if (!g.ok) return { ...base, llm: null, wait: `models: ${g.why}` };
    return {
      ...base,
      llm: meteredModel(o.llm, {
        main: o.db,
        client,
        part: "learn.breakdown",
        now,
        store: o.keys ?? null,
        own: llmForKey,
      }),
    };
  };
}
