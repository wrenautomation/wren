import { describe, expect, it } from "vitest";
import { cosine, EMBED_DIMS, gatewayEmbed } from "./embed.js";

describe("gatewayEmbed", () => {
  it("is null without the gateway", () => {
    expect(gatewayEmbed({})).toBeNull();
  });

  it("asks the gateway's batch embed and returns unit vectors", async () => {
    const seen = { url: "", auth: null as string | null, body: "" };
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.url = String(input);
      seen.auth = new Headers(init?.headers).get("authorization");
      seen.body = String(init?.body);
      const n = (JSON.parse(String(init?.body)) as { requests: unknown[] }).requests.length;
      return Response.json({
        embeddings: Array.from({ length: n }, () => ({ values: Array(EMBED_DIMS).fill(2) })),
      });
    }) as unknown as typeof fetch;
    const embed = gatewayEmbed(
      { WREN_LLM_GATEWAY_URL: "https://gw.example/v1", WREN_LLM_GATEWAY_TOKEN: "tok" },
      fetchFn,
    );
    const [v] = (await embed?.(["a query"], "query")) ?? [];
    expect(seen).toMatchObject({
      url: "https://gw.example/v1beta/models/gemini-embedding-001:batchEmbedContents",
      auth: "Bearer tok",
    });
    expect(JSON.parse(seen.body).requests[0]).toMatchObject({
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBED_DIMS,
    });
    expect(cosine(v ?? [], v ?? [])).toBeCloseTo(1);
  });
});
