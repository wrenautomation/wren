import { describe, expect, it } from "vitest";
import { agentOf } from "./agent.js";
import { type CallResult, type Pipeline, runCall, type Turn } from "./call.js";
import {
  type CallerLine,
  FakeCalendar,
  FakeEars,
  FakeLeads,
  FakeMessages,
  FakeMouth,
  FakeTransport,
  ScriptedBrain,
  transcriptText,
} from "./fakes.js";
import { TextTransport } from "./transports/text.js";
import type { Brain, BrainInput, Incoming, Thought, Transport } from "./types.js";

const NOW = new Date("2026-10-06T15:00:00Z"); // Tue 11:00 in Toronto
const SAM = "+15555550123";

function ports() {
  return { leads: new FakeLeads(), calendar: new FakeCalendar(), messages: new FakeMessages() };
}

/** A typed call: each line typed once the agent's turn before it settles. */
async function typed(lines: string[], settings: object = {}, brain: Brain = new ScriptedBrain()) {
  const p = ports();
  const said: string[] = [];
  let next = 0;
  let t!: TextTransport;
  t = new TextTransport(
    { id: "t1", from: SAM, to: "", direction: "test" },
    { said: (text) => said.push(text), ended: () => {} },
  );
  const onTurn = () => {
    const line = lines[next++];
    setTimeout(() => (line === undefined ? t.leave() : t.type(line)), 0);
  };
  const result = await runCall({
    pipeline: { transport: t, brain },
    agent: agentOf(settings),
    ports: p,
    date: () => NOW,
    onTurn,
  });
  return { result, said, ...p };
}

/** A spoken call on the fake line: fake ears, mouth and caller. */
async function spoken(
  script: CallerLine[],
  settings: object = {},
  o: { brain?: Brain; mouth?: FakeMouth } = {},
) {
  const p = ports();
  const transport = new FakeTransport(script);
  const pipeline: Pipeline = {
    transport,
    ears: new FakeEars(),
    brain: o.brain ?? new ScriptedBrain(),
    mouth: o.mouth ?? new FakeMouth(),
  };
  const result = await runCall({
    pipeline,
    agent: agentOf({ turn: { pauseMs: 200 }, ...settings }),
    ports: p,
    date: () => NOW,
  });
  return { result, transport, ...p };
}

const tools = (r: CallResult) => r.transcript.filter((l) => l.who === "tool").map((l) => l.tool);

describe("a typed call", () => {
  it("says it's an AI first, books a call, and says goodbye", async () => {
    const { result, said, calendar } = await typed([
      "Hi, I'd like to book a call",
      "The first one works",
      "That's all, bye",
    ]);
    expect(said[0]).toBe("Hi, this is Wren's AI assistant. How can I help?");
    expect(tools(result)).toEqual(["offerTimes", "book", "endCall"]);
    expect(result.outcome).toBe("booked");
    expect(calendar.booked).toHaveLength(1);
    expect(calendar.booked[0]?.email).toBe("sam@example.com");
    expect(result.booking?.id).toBe(1);
    expect(result.lead?.name).toBe("Sam Example");
    expect(result.pipeline).toBe("text · scripted");
    // Each line in order: the caller's words, then the agent's, then the tool's.
    expect(transcriptText(result.transcript)).toMatch(
      /caller: Hi, I'd like to book a call\nagent: Let me find a time\. One moment\.\n\[offerTimes\]/,
    );
  });

  it("times every turn from the end of the caller's line", async () => {
    const { result } = await typed(["Can I book a time?"]);
    expect(result.turns.map((t) => t.n)).toEqual([0, 1]);
    const t = result.turns[1] as Turn;
    expect(t.caller).toBe("Can I book a time?");
    expect(t.tools).toEqual(["offerTimes"]);
    expect(t.speculative).toBe(false);
    for (const k of ["final", "end", "token", "audio", "heard"] as const)
      expect(t.ms[k]).not.toBeNull();
    expect(t.ms.final).toBe(0);
    expect(t.ms.token as number).toBeLessThanOrEqual(t.ms.audio as number);
    expect(result.outcome).toBe("hung_up");
  });

  it("takes a message", async () => {
    const { result, messages } = await typed([
      "Can you take a message?",
      "Call me back about the quote",
    ]);
    expect(messages.taken).toEqual([
      { text: "Call me back about the quote", callback: null, from: SAM },
    ]);
    expect(result.outcome).toBe("message");
    expect(result.message).toBe("Call me back about the quote");
  });

  it("puts the caller through in hours, and not without a number", async () => {
    const through = await typed(["Can I talk to a person?"], { transferTo: "+15555550100" });
    expect(through.result.outcome).toBe("transferred");
    const none = await typed(["Can I talk to a person?"]);
    expect(none.result.outcome).toBe("hung_up");
    expect(none.result.transcript.find((l) => l.tool === "transfer")?.text).toMatch(
      /No one takes calls/,
    );
  });

  it("can't use a tool the agent doesn't have", async () => {
    const { result, calendar } = await typed(["I'd like to book a call"], {
      tools: ["takeMessage", "endCall"],
    });
    expect(tools(result)).toEqual([]);
    expect(calendar.booked).toHaveLength(0);
  });

  it("adds the AI line when the agent's own doesn't say it", async () => {
    const { said } = await typed([], { firstLine: "Hello, Example Plumbing." });
    expect(said[0]).toBe("This is Wren's AI assistant. Hello, Example Plumbing.");
  });

  it("asks before recording", async () => {
    const { said } = await typed([], { record: true });
    expect(said.join(" ")).toMatch(/This call may be recorded\. Is that OK\?$/);
  });

  it("a brain that throws ends the call with an apology", async () => {
    const broken: Brain = {
      name: "broken",
      think(): AsyncIterable<Thought> {
        throw new Error("model down");
      },
    };
    const { result, said } = await typed(["Hello?"], {}, broken);
    expect(result.outcome).toBe("failed");
    expect(said.at(-1)).toMatch(/something went wrong/);
  });
});

describe("a spoken call on the fake line", () => {
  it("books, with every stage timed and answers started before the pause", async () => {
    const { result, calendar, transport } = await spoken([
      { say: "Hi I want to book a call" },
      { say: "The second one" },
      { say: "Bye" },
    ]);
    expect(result.outcome).toBe("booked");
    expect(calendar.booked).toHaveLength(1);
    expect(transport.heard[0]).toBe("Hi, this is Wren's AI assistant. How can I help?");
    const answered = result.turns.filter((t) => t.n > 0);
    expect(answered).toHaveLength(3);
    for (const t of answered) {
      expect(t.speculative, t.caller).toBe(true);
      // The brain started on the final words; the answer waited for the pause, then played.
      expect(t.ms.token as number).toBeLessThan(t.ms.end as number);
      expect(t.ms.end as number).toBeGreaterThanOrEqual(190);
      expect(t.ms.audio as number).toBeGreaterThanOrEqual(t.ms.end as number);
      expect(t.ms.heard as number).toBeGreaterThanOrEqual(t.ms.audio as number);
    }
    expect(result.pipeline).toBe("fake · fake-ears · scripted · fake-mouth");
  });

  it("plays a cached filler while a tool runs", async () => {
    const { transport } = await spoken([{ say: "Can I book a time" }]);
    expect(transport.heard[1]).toMatch(/^Let me find a time\. One moment\. I have /);
  });

  it("stops talking at once when the caller talks over it", async () => {
    const slow = new FakeMouth({ wordMs: 15 });
    const { result, transport } = await spoken(
      [{ say: "Book a call please" }, { say: "Wait stop", over: 3 }],
      {},
      { mouth: slow },
    );
    expect(transport.cleared).toBeGreaterThan(0);
    const cut = result.turns.find((t) => t.barged);
    expect(cut?.caller).toBe("Book a call please");
    expect(result.transcript.some((l) => l.who === "agent" && l.text.endsWith("(cut off)"))).toBe(
      true,
    );
    // The next turn answers what the caller said over it.
    expect(result.turns.some((t) => t.caller === "Wait stop")).toBe(true);
  });

  it("drops an answer when the caller goes on before the pause ends the turn", async () => {
    const seen: string[] = [];
    const brain = new (class extends ScriptedBrain {
      override async *think(input: BrainInput, signal: AbortSignal) {
        seen.push(input.transcript.at(-1)?.text ?? "");
        yield* super.think(input, signal);
      }
    })();
    // Words in, our endpointing: "Hello", then more 50 ms later, inside the 200 ms pause.
    let on: (e: Incoming) => void = () => {};
    const said: string[] = [];
    const line: Transport = {
      name: "lines",
      carries: "text",
      endpointing: "ours",
      async open(fn) {
        on = fn;
        fn({ kind: "start", call: { id: "l1", from: "", to: "", direction: "test" } });
      },
      send(out) {
        if (out.kind === "text") said.push(out.text);
        queueMicrotask(() => on({ kind: "idle" }));
      },
      clear() {},
      async transfer() {},
      async hangup() {},
    };
    const run = runCall({
      pipeline: { transport: line, brain },
      agent: agentOf({ turn: { pauseMs: 200 } }),
      ports: ports(),
      date: () => NOW,
      onTurn: (t) => {
        if (t.n === 1) setTimeout(() => on({ kind: "hangup" }), 0);
      },
    });
    const at = (ms: number, e: Incoming) => setTimeout(() => on(e), ms);
    at(10, { kind: "words", text: "Hello", final: true });
    at(60, { kind: "words", text: "is anyone", final: false });
    at(70, { kind: "words", text: "is anyone there", final: true });
    const result = await run;
    expect(seen).toEqual(["Hello", "Hello is anyone there"]);
    expect(result.turns[1]?.caller).toBe("Hello is anyone there");
    expect(result.turns[1]?.speculative).toBe(true);
    // The opener, then one answer of two sentences: the dropped one never went out.
    expect(said).toHaveLength(3);
  });

  it("with barge-in off, finishes its answer and then takes the caller's turn", async () => {
    const slow = new FakeMouth({ wordMs: 15 });
    const { result, transport } = await spoken(
      [{ say: "Book a call please" }, { say: "Wait stop", over: 3 }],
      { turn: { pauseMs: 200, bargeIn: false } },
      { mouth: slow },
    );
    expect(transport.cleared).toBe(0);
    expect(result.turns.some((t) => t.barged)).toBe(false);
    expect(result.turns.some((t) => t.caller === "Wait stop")).toBe(true);
  });

  it("ends a call that runs past its limit", async () => {
    const p = ports();
    const transport = new FakeTransport([{ say: "Hi" }, { say: "Still here" }], { gapMs: 5 });
    let fake = 0;
    const result = await runCall({
      pipeline: {
        transport,
        ears: new FakeEars(),
        brain: new ScriptedBrain(),
        mouth: new FakeMouth(),
      },
      agent: { ...agentOf({}), maxMinutes: 0.0005 as number },
      ports: p,
      clock: () => fake++,
      date: () => NOW,
    });
    expect(result.outcome).toBe("timed_out");
    expect(transport.hungUp).toBe(true);
  });
});
