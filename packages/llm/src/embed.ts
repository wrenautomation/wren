/**
 * Text embeddings: Gemini's `gemini-embedding-001` through the LLM gateway, cut to `EMBED_DIMS`
 * and scaled to length 1, so a dot product is the cosine. Free keys, the gateway's limits.
 */
import type { EnvMap } from "./client.js";

export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 256;

/** A document is embedded to be found; a query to find one. */
export type EmbedTask = "document" | "query";
export type Embed = (texts: string[], task: EmbedTask) => Promise<number[][]>;

const unit = (v: number[]): number[] => {
  const n = Math.hypot(...v);
  return n ? v.map((x) => x / n) : v;
};

/** Cosine of two unit vectors. */
export const cosine = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

/** The gateway's embedder; null when `WREN_LLM_GATEWAY_URL` or its token is unset. */
export function gatewayEmbed(env: EnvMap, fetchFn: typeof fetch = fetch): Embed | null {
  const base = env.WREN_LLM_GATEWAY_URL;
  const token = env.WREN_LLM_GATEWAY_TOKEN;
  if (!base || !token) return null;
  const url = `${new URL(base).origin}/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
  return async (texts, task) => {
    if (!texts.length) return [];
    const res = await fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
          taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBED_DIMS,
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`embed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { embeddings?: { values?: number[] }[] };
    const out = (body.embeddings ?? []).map((e) => unit(e.values ?? []));
    if (out.length !== texts.length || out.some((v) => v.length !== EMBED_DIMS))
      throw new Error(`embed: ${out.length} vectors for ${texts.length} texts`);
    return out;
  };
}
