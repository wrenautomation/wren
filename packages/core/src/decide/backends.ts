/**
 * Who answers a decision. Every backend takes Jev's `/v1/systemone` shape (a `state` and typed
 * questions) and answers in it, so a kind never knows which one ran.
 *
 * - `jev`: TypeSafe's API through its SDK. Laya (`laya-serve`) speaks the same shape, so it is
 *   this backend with another base URL and model.
 * - `gateway`: our LLM gateway asked for the same answers as JSON, turned into the same shape.
 * - `agent`: Claude Code on the desk (`claude/ask`, William's plan, $0), asked for the same answers
 *   plus a `why`; the answer keeps the session id, so `claude --resume <id>` opens the run.
 *   Kinds whose `judge` is `agent` go only to it (designs/2026-11-04-loops.md).
 *
 * `WREN_DECIDE` picks: `jev` (default), `jev:<model>`, `laya:<model>` (with `WREN_DECIDE_URL`),
 * `gateway`, `gateway:<model>`, `off`. Jev's key is `TYPESAFE_API_KEY`.
 */
import { createHash } from "node:crypto";
import {
  APIError,
  type ChoiceQuestion,
  type EntryType,
  type Fetch,
  type Questions,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

/** What a backend answered, in Jev's shape. */
export interface Answered {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface DecideBackend {
  /** `jev`, `laya`, `gateway`: the row's `backend`. */
  readonly name: string;
  /** US dollars per 1M input and output tokens. */
  readonly price: { input: number; output: number };
  ask(
    req: { state: EntryType; questions: Questions },
    o: { signal?: AbortSignal },
  ): Promise<Answered>;
}

/** Jev's price (typesafe.ai pricing, 2026-10-16): input only, output free. */
export const JEV_PRICE = { input: 0.042, output: 0 } as const;
const JEV_MODEL = "jev-1.13.0";
/** One try's wait; the SDK tries twice at most. */
const JEV_TRY_MS = 20_000;

/** Dollars a call cost: `usage` priced at the backend's rate. */
export const costOf = (price: DecideBackend["price"], usage: Answered["usage"]): number =>
  (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;

/**
 * Why a call failed, which says what happens next. `refused`: the input itself (400, 413, 415,
 * 422): kept as an error row, never asked again. `key`: the key or account (401, 402, 403): the
 * pass stops. `down`: anything else (429, 5xx, a timeout): the fallback answers, else it waits.
 */
export type Failure = "refused" | "key" | "down";
export function failureOf(err: unknown): Failure {
  const status = err instanceof APIError ? err.status : (err as { status?: unknown })?.status;
  if (typeof status !== "number") return "down";
  if ([400, 413, 415, 422].includes(status)) return "refused";
  if ([401, 402, 403].includes(status)) return "key";
  return "down";
}

/** Jev, or Laya on Jev's shape. */
export function jevBackend(o: {
  apiKey: string;
  name?: "jev" | "laya";
  model?: string;
  baseURL?: string;
  fetch?: Fetch;
  tryMs?: number;
  price?: DecideBackend["price"];
}): DecideBackend {
  const client = new TypeSafeClient({
    apiKey: o.apiKey,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
    defaultModel: o.model ?? JEV_MODEL,
    timeout: o.tryMs ?? JEV_TRY_MS,
    retry: { maxRetries: 1 },
    logLevel: "off",
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  return {
    name: o.name ?? "jev",
    price: o.price ?? (o.name === "laya" ? { input: 0, output: 0 } : JEV_PRICE),
    async ask(req, { signal }) {
      const r = await client.systemOne(
        { state: req.state, questions: req.questions },
        signal ? { signal } : {},
      );
      return {
        model: r.model,
        answers: r.answers as Record<string, unknown>,
        usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
      };
    },
  };
}

/** The structural slice of `@wren/llm`'s client a gateway backend needs. */
export interface CompleteLike {
  readonly name: string;
  complete(
    prompt: string,
    opts?: { maxTokens?: number; system?: string },
  ): Promise<{ text: string; raw: Record<string, unknown> }>;
}

const GATEWAY_SYSTEM =
  "You answer classification questions about a JSON `state`. Reply with JSON only: for each question id, " +
  '{"probabilities": {"<label>": <0..1>, ...}} over exactly its labels, summing to 1.';

/** A choice's confidence from its probabilities, Jev's way: (n * peak - 1) / (n - 1). */
export function choiceConfidence(probs: Record<string, number>): number {
  const v = Object.values(probs);
  if (v.length < 2) return 1;
  const peak = Math.max(...v);
  return Math.max(0, Math.min(1, (v.length * peak - 1) / (v.length - 1)));
}

/** Tokens from a provider body, when it says. */
function usageOf(raw: Record<string, unknown>): Answered["usage"] {
  const u = (raw.usage ?? {}) as Record<string, unknown>;
  const n = (...ks: string[]) => {
    for (const k of ks) if (typeof u[k] === "number") return u[k] as number;
    return 0;
  };
  return {
    input_tokens: n("input_tokens", "inputTokens", "prompt_tokens", "promptTokens"),
    output_tokens: n("output_tokens", "outputTokens", "completion_tokens", "completionTokens"),
  };
}

/** The choice questions of a request, or a throw naming one that is not. */
function choiceQuestions(who: string, questions: Questions): [string, ChoiceQuestion][] {
  const qs = Object.entries(questions);
  for (const [id, q] of qs)
    if (q.type !== "choice") throw new Error(`${who} answers choice questions; ${id} is ${q.type}`);
  return qs as [string, ChoiceQuestion][];
}

/** A model's probabilities over a question's labels as Jev's choice answer; `extra` rides along. */
function choiceAnswer(
  who: string,
  id: string,
  q: ChoiceQuestion,
  got: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const labels = Object.keys(q.criteria);
  const raw = labels.map((l) => Math.max(0, Number(got[l]) || 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!sum) throw new Error(`${who} gave no probabilities for ${id}`);
  const probabilities = Object.fromEntries(labels.map((l, i) => [l, (raw[i] ?? 0) / sum]));
  const choice = labels.reduce((a, b) =>
    (probabilities[b] ?? 0) > (probabilities[a] ?? 0) ? b : a,
  );
  return {
    type: "choice",
    choice,
    confidence: choiceConfidence(probabilities),
    probabilities,
    ...extra,
  };
}

/** The first `{...}` span of a reply, parsed. */
const jsonIn = (text: string) =>
  JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;

/** The gateway on Jev's shape. Choice questions only: every kind asks one. */
export function gatewayBackend(llm: CompleteLike): DecideBackend {
  return {
    name: "gateway",
    price: { input: 0, output: 0 },
    async ask(req) {
      const qs = choiceQuestions("the gateway", req.questions);
      const prompt = JSON.stringify({
        state: req.state,
        questions: Object.fromEntries(
          qs.map(([id, q]) => [id, { instructions: q.instructions, labels: q.criteria }]),
        ),
      });
      const r = await llm.complete(prompt, { system: GATEWAY_SYSTEM, maxTokens: 400 });
      const json = jsonIn(r.text) as Record<string, { probabilities?: Record<string, unknown> }>;
      const answers: Record<string, unknown> = {};
      for (const [id, q] of qs)
        answers[id] = choiceAnswer(
          "the gateway",
          id,
          q,
          (json?.[id]?.probabilities ?? json?.[id] ?? {}) as Record<string, unknown>,
        );
      return { model: llm.name, answers, usage: usageOf(r.raw) };
    },
  };
}

/** The desk's `claude/ask` answer, as far as the judge reads it. */
export interface AgentAnswer {
  answer: string;
  model: string;
  /** `claude --resume <sessionId>` opens the run: the agent's id on the row. */
  sessionId: string;
}

/**
 * One question to the agent. `key` is the call's idempotency key: the same question within a day
 * gets the run already made, so a pass that gave up on a slow Mac picks the answer up next time.
 */
export type AgentAsk = (
  req: { question: string; system: string; model: string },
  key: string,
) => Promise<AgentAnswer>;

/** The judge's model on the plan. */
export const JUDGE_MODEL = "sonnet";

const JUDGE_SYSTEM =
  "You are Wren's judge. You read one JSON `state` and answer each question in `questions` from it alone: " +
  "use no tools and read no files. Reply with JSON only, one key per question id: " +
  '{"<id>": {"probabilities": {"<label>": <0..1>, ...}, "why": "<one plain sentence: the facts in state that decide it>"}}. ' +
  "The probabilities cover exactly that question's labels and sum to 1.";

/** Claude Code on the desk, on Jev's shape: each answer carries `why` and the `agent` session id. */
export function agentBackend(ask: AgentAsk, model = JUDGE_MODEL): DecideBackend {
  return {
    name: "agent",
    price: { input: 0, output: 0 },
    async ask(req) {
      const qs = choiceQuestions("the agent", req.questions);
      const question = JSON.stringify({
        state: req.state,
        questions: Object.fromEntries(
          qs.map(([id, q]) => [id, { instructions: q.instructions, labels: q.criteria }]),
        ),
      });
      const key = `judge:${createHash("sha256").update(question).digest("hex").slice(0, 32)}`;
      const r = await ask({ question, system: JUDGE_SYSTEM, model }, key);
      const json = jsonIn(r.answer) as Record<
        string,
        { probabilities?: Record<string, unknown>; why?: unknown }
      >;
      const answers: Record<string, unknown> = {};
      for (const [id, q] of qs) {
        const a = json?.[id] ?? {};
        answers[id] = choiceAnswer("the agent", id, q, a.probabilities ?? {}, {
          why: typeof a.why === "string" ? a.why.slice(0, 500) : null,
          agent: r.sessionId,
        });
      }
      return {
        model: `claude-code:${r.model || model}`,
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  };
}

/** The backends a spec names: the first answers, the rest stand by for a `down` failure. */
export interface BackendChoice {
  /** Empty: deciding is off for the `model` kinds. */
  chain: DecideBackend[];
  /** The judge for the `agent` kinds; null: they wait. */
  agent?: DecideBackend | null;
  /** Why the chain is short (no key), for the pass's stats. */
  note: string | null;
}

/** The chain a kind is judged by: the agent alone for an `agent` kind, else the model chain. */
export function chainFor(choice: BackendChoice, judge: "agent" | "model"): DecideBackend[] {
  if (judge === "model") return choice.chain;
  return choice.agent ? [choice.agent] : [];
}

/**
 * `WREN_DECIDE` read, plus the agent when `o.agent` is given. `gateway` needs `llm(spec)` (the caller's `makeLlm`); without it a gateway
 * spec is off and Jev runs alone.
 */
export function backendsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  llm?: ((spec: string) => CompleteLike) | null,
  o: { fetch?: Fetch; agent?: AgentAsk } = {},
): BackendChoice {
  const spec = (env.WREN_DECIDE ?? "jev").trim();
  if (spec === "off") return { chain: [], agent: null, note: "WREN_DECIDE=off" };
  const agent = o.agent ? agentBackend(o.agent) : null;
  return { ...modelChain(env, spec, llm, o.fetch), agent };
}

/** The chain the `model` kinds use, from `WREN_DECIDE`'s spec. */
function modelChain(
  env: Readonly<Record<string, string | undefined>>,
  spec: string,
  llm: ((spec: string) => CompleteLike) | null | undefined,
  fetch: Fetch | undefined,
): Omit<BackendChoice, "agent"> {
  const o = fetch ? { fetch } : {};
  const [head, ...rest] = spec.split(":");
  const model = rest.join(":") || undefined;
  let gateway: DecideBackend | null = null;
  try {
    // No gateway keys here (a laptop without them): Jev runs alone.
    if (llm)
      gateway = gatewayBackend(llm(head === "gateway" && model ? `gateway:${model}` : "gateway"));
  } catch {
    gateway = null;
  }
  if (head === "gateway")
    return gateway ? { chain: [gateway], note: null } : { chain: [], note: "no gateway client" };
  const key = env.TYPESAFE_API_KEY;
  if (head === "laya") {
    const url = env.WREN_DECIDE_URL;
    if (!url) return { chain: gateway ? [gateway] : [], note: "laya needs WREN_DECIDE_URL" };
    const laya = jevBackend({
      apiKey: key ?? "laya",
      name: "laya",
      baseURL: url,
      ...(model ? { model } : {}),
      ...o,
    });
    return { chain: gateway ? [laya, gateway] : [laya], note: null };
  }
  if (head !== "jev")
    throw new Error(
      `WREN_DECIDE is jev, jev:<model>, laya:<model>, gateway[:model] or off; got ${spec}`,
    );
  if (!key) return { chain: gateway ? [gateway] : [], note: "no TYPESAFE_API_KEY" };
  const jev = jevBackend({
    apiKey: key,
    ...(model ? { model } : {}),
    ...(env.WREN_DECIDE_URL ? { baseURL: env.WREN_DECIDE_URL } : {}),
    ...o,
  });
  return { chain: gateway ? [jev, gateway] : [jev], note: null };
}
