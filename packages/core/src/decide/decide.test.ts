import { describe, expect, it } from "vitest";
import {
  backendsFromEnv,
  type CompleteLike,
  choiceConfidence,
  costOf,
  failureOf,
  gatewayBackend,
  JEV_PRICE,
  jevBackend,
} from "./backends.js";
import { isCommentCall } from "./comments.js";
import { KINDS, keepOf, machineLabel, PICK } from "./kinds.js";

const jevReply = {
  model: "jev-1.13.0",
  answers: {
    pick: {
      type: "choice",
      choice: "drop",
      confidence: 0.4,
      probabilities: { send: 0.2, edit: 0.2, drop: 0.6 },
    },
  },
  usage: { input_tokens: 1_000_000, output_tokens: 55 },
};

function fakeFetch(status: number, body: unknown) {
  const seen: { url: string; body: unknown }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, seen };
}

describe("kinds", () => {
  it("every kind asks one choice under pick, with a label for each criterion", () => {
    for (const k of Object.values(KINDS)) {
      const q = k.questions[PICK];
      expect(q?.type).toBe("choice");
      if (q?.type !== "choice") continue;
      expect(Object.keys(q.criteria).sort()).toEqual(Object.keys(k.labels).sort());
      expect(k.gate).toBe(false);
    }
  });

  it("send and edit keep a comment; drop doesn't", () => {
    expect(keepOf("comment_quality", "send")).toBe(true);
    expect(keepOf("comment_quality", "edit")).toBe(true);
    expect(keepOf("comment_quality", "drop")).toBe(false);
    expect(() => keepOf("comment_quality", "maybe")).toThrow();
  });

  it("reads the pick and sums the keep side", () => {
    expect(machineLabel("comment_quality", jevReply.answers)).toEqual({
      label: "drop",
      p: 0.4,
      confidence: 0.4,
    });
    expect(machineLabel("learn_worth", { pick: { type: "choice", choice: "nope" } })).toBeNull();
  });
});

describe("backends", () => {
  it("prices Jev on input alone", () => {
    expect(costOf(JEV_PRICE, { input_tokens: 1_000_000, output_tokens: 9_999 })).toBeCloseTo(0.042);
  });

  it("asks Jev through the SDK on its shape", async () => {
    const f = fakeFetch(200, jevReply);
    const b = jevBackend({ apiKey: "k", fetch: f.fetch, baseURL: "https://jev.test" });
    const r = await b.ask(
      { state: { draft: "x" }, questions: KINDS.comment_quality.questions },
      {},
    );
    expect(r.model).toBe("jev-1.13.0");
    expect(r.usage.input_tokens).toBe(1_000_000);
    expect(f.seen[0]?.url).toBe("https://jev.test/v1/systemone");
    expect(f.seen[0]?.body).toMatchObject({ state: { draft: "x" }, model: "jev-1.13.0" });
  });

  it("sorts failures: refused input, refused key, outage", async () => {
    const ask = async (status: number) => {
      const b = jevBackend({ apiKey: "k", fetch: fakeFetch(status, { error: "no" }).fetch });
      return b.ask({ state: {}, questions: KINDS.learn_worth.questions }, {}).catch((e) => e);
    };
    expect(failureOf(await ask(422))).toBe("refused");
    expect(failureOf(await ask(401))).toBe("key");
    expect(failureOf(new Error("socket hang up"))).toBe("down");
  });

  it("turns the gateway's JSON into Jev's shape", async () => {
    const llm: CompleteLike = {
      name: "gateway:free",
      complete: async () => ({
        text: '```json\n{"pick": {"probabilities": {"worth": 3, "skip": 1}}}\n```',
        raw: { usage: { inputTokens: 120, outputTokens: 9 } },
      }),
    };
    const r = await gatewayBackend(llm).ask(
      { state: {}, questions: KINDS.learn_worth.questions },
      {},
    );
    expect(r.answers.pick).toEqual({
      type: "choice",
      choice: "worth",
      confidence: 0.5,
      probabilities: { worth: 0.75, skip: 0.25 },
    });
    expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 9 });
  });

  it("computes choice confidence Jev's way", () => {
    expect(choiceConfidence({ a: 1, b: 0 })).toBe(1);
    expect(choiceConfidence({ a: 0.5, b: 0.5 })).toBe(0);
  });

  it("reads WREN_DECIDE", () => {
    const llm = () => ({ name: "g", complete: async () => ({ text: "", raw: {} }) });
    expect(backendsFromEnv({ WREN_DECIDE: "off" }).chain).toEqual([]);
    expect(backendsFromEnv({}).note).toBe("no TYPESAFE_API_KEY");
    expect(backendsFromEnv({}, llm).chain.map((b) => b.name)).toEqual(["gateway"]);
    expect(backendsFromEnv({ TYPESAFE_API_KEY: "k" }, llm).chain.map((b) => b.name)).toEqual([
      "jev",
      "gateway",
    ]);
    expect(
      backendsFromEnv({ WREN_DECIDE: "laya:laya-0.1", WREN_DECIDE_URL: "http://laya" }).chain.map(
        (b) => [b.name, b.price.input],
      ),
    ).toEqual([["laya", 0]]);
    expect(backendsFromEnv({ WREN_DECIDE: "laya:x" }).note).toBe("laya needs WREN_DECIDE_URL");
    expect(() => backendsFromEnv({ WREN_DECIDE: "nope" })).toThrow();
  });
});

describe("comment calls", () => {
  it("counts his sends and drops, not a scheduler's or a backfill's", () => {
    const c = { kind: "thread" as const };
    expect(isCommentCall({ ...c, event: "sent", via: "person" })).toBe(true);
    expect(isCommentCall({ ...c, event: "sent", via: "claude" })).toBe(true);
    expect(isCommentCall({ ...c, event: "sent", via: "wren" })).toBe(false);
    expect(isCommentCall({ ...c, event: "rejected", via: "person" })).toBe(true);
    expect(isCommentCall({ ...c, event: "rejected", via: "wren" })).toBe(false);
    expect(isCommentCall({ ...c, event: "sent", via: "person", ref: "bf:x" })).toBe(false);
    expect(isCommentCall({ kind: "dm", event: "sent", via: "person" })).toBe(false);
  });
});
