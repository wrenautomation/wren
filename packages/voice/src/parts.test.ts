import { describe, expect, it } from "vitest";
import { agentOf, agentSettingsSchema, inHours, openingLine, stretchesOf } from "./agent.js";
import { promptOf, thoughtsOf } from "./brain.js";
import { FakeCalendar, FakeLeads, FakeMessages, ScriptedBrain } from "./fakes.js";
import { SentenceCutter } from "./sentences.js";
import { runTool, TOOL_SPECS, toolsOf } from "./tools.js";

const NOW = new Date("2026-10-06T15:00:00Z"); // Tue 11:00 in Toronto
const call = { id: "c", from: "+15555550123", to: "+15555550100", direction: "inbound" as const };

describe("the agent", () => {
  it("is a working agent from {}", () => {
    const a = agentOf({});
    expect(a.tools).toEqual(Object.keys(TOOL_SPECS));
    expect(a.turn).toEqual({ pauseMs: 700, bargeIn: true });
    expect(a.outbound).toBe(false);
  });

  it("refuses settings that don't read", () => {
    expect(agentSettingsSchema.safeParse({ zone: "Mars/Base" }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ hours: { mon: "9 to 5" } }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ transferTo: "555-0100" }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ turn: { pauseMs: 50 } }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("reads hours", () => {
    expect(stretchesOf("09:00-12:00, 13:00-17:00")).toEqual([
      [540, 720],
      [780, 1020],
    ]);
    expect(stretchesOf("")).toEqual([]);
    expect(stretchesOf("17:00-09:00")).toBeNull();
    const a = agentOf({});
    expect(inHours(a, NOW)).toBe(true);
    expect(inHours(a, new Date("2026-10-06T23:00:00Z"))).toBe(false); // 19:00
    expect(inHours(a, new Date("2026-10-04T15:00:00Z"))).toBe(false); // Sunday
  });

  it("says it's an AI, and asks before recording where the state needs it", () => {
    expect(openingLine(agentOf({ firstLine: "Hi, an automated assistant here." }))).toBe(
      "Hi, an automated assistant here.",
    );
    expect(openingLine(agentOf({ firstLine: "Hi, Wren's assistant here." }))).toMatch(
      /^This is Wren's AI assistant\./,
    );
    const rec = agentOf({ record: true });
    expect(openingLine(rec, "CA")).toMatch(/may be recorded/);
    expect(openingLine(rec, "TX")).not.toMatch(/recorded/);
    expect(openingLine(rec, null)).toMatch(/may be recorded/);
  });
});

describe("sentences", () => {
  it("cuts streamed text at sentence ends, keeping abbreviations", () => {
    const c = new SentenceCutter();
    expect(c.push("Hi there. Dr. Smi")).toEqual(["Hi there."]);
    expect(c.push("th is in. Ok")).toEqual(["Dr. Smith is in."]);
    expect(c.push("? Yes")).toEqual(["Ok?"]);
    expect(c.flush()).toBe("Yes");
    expect(c.flush()).toBeNull();
    expect(new SentenceCutter().push("It costs 3.5 dollars. Fine")).toEqual([
      "It costs 3.5 dollars.",
    ]);
  });
});

describe("tools", () => {
  const ports = () => ({
    leads: new FakeLeads(),
    calendar: new FakeCalendar(),
    messages: new FakeMessages(),
  });
  const ctx = (settings: object = {}) => ({ agent: agentOf(settings), call, lead: null, now: NOW });

  it("looks up the caller by number, or the callee on an outbound call", async () => {
    const p = ports();
    expect((await runTool("lookUpLead", {}, p, ctx())).effect).toMatchObject({
      kind: "lead",
      lead: { name: "Sam Example" },
    });
    const out = { ...ctx(), call: { ...call, direction: "outbound" as const } };
    expect((await runTool("lookUpLead", {}, p, out)).says).toBe("No record of this number.");
  });

  it("offers times and books one, once", async () => {
    const p = ports();
    const offered = await runTool("offerTimes", {}, p, ctx());
    const iso = /\((\S+)\)/.exec(offered.says)?.[1] as string;
    const args = { start: iso, name: "Sam Example", email: "Sam@Example.com" };
    const b = await runTool("book", args, p, ctx());
    expect(b.effect).toMatchObject({ kind: "booked", id: 1 });
    expect(p.calendar.booked[0]?.email).toBe("sam@example.com");
    expect((await runTool("book", args, p, ctx())).says).toMatch(/just taken/);
    expect((await runTool("book", { ...args, email: "nope" }, p, ctx())).says).toMatch(/email/);
    expect((await runTool("book", { name: "x", email: "a@b.co" }, p, ctx())).says).toMatch(
      /Which time/,
    );
  });

  it("transfers only in hours, to the set number", async () => {
    const p = ports();
    const on = { transferTo: "+15555550100" };
    expect((await runTool("transfer", {}, p, ctx(on))).effect).toEqual({
      kind: "transfer",
      to: "+15555550100",
    });
    const late = { ...ctx(on), now: new Date("2026-10-06T23:30:00Z") };
    expect((await runTool("transfer", {}, p, late)).effect).toBeUndefined();
    expect((await runTool("transfer", {}, p, ctx())).effect).toBeUndefined();
  });

  it("refuses a tool the agent doesn't have", async () => {
    const r = await runTool("book", {}, ports(), ctx({ tools: ["endCall"] }));
    expect(r.says).toMatch(/isn't something this agent may do/);
    expect(toolsOf(agentOf({ tools: ["endCall"] })).map((t) => t.name)).toEqual(["endCall"]);
  });
});

describe("the LLM brain's format", () => {
  it("reads the model's JSON, and speaks anything else as is", () => {
    expect(thoughtsOf('```json\n{"say":"One moment.","tool":"offerTimes","args":{}}\n```')).toEqual(
      [
        { kind: "text", text: "One moment." },
        { kind: "tool", name: "offerTimes", args: {} },
      ],
    );
    expect(thoughtsOf('{"say":"Hi.","tool":null}')).toEqual([{ kind: "text", text: "Hi." }]);
    expect(thoughtsOf("Sure thing.")).toEqual([{ kind: "text", text: "Sure thing." }]);
  });

  it("tells the model its tools, the lead and the call so far", () => {
    const { system, prompt } = promptOf({
      system: "Be brief.",
      lead: { name: "Sam Example", company: null, email: null, zone: null, notes: null },
      transcript: [
        { who: "caller", text: "Hi" },
        { who: "tool", tool: "offerTimes", text: "Open times: none." },
      ],
      tools: toolsOf(agentOf({ tools: ["book"] })),
    });
    expect(system).toMatch(/^Be brief\.\n\nTools:\n- book: .* Args: start: /);
    expect(prompt).toMatch(/Name: Sam Example/);
    expect(prompt).toMatch(/Caller: Hi\n\[offerTimes result\] Open times: none\./);
  });

  it("the scripted brain streams words, then its tool", async () => {
    const out = [];
    for await (const t of new ScriptedBrain().think(
      {
        system: "",
        lead: null,
        transcript: [{ who: "caller", text: "book me a call" }],
        tools: toolsOf(agentOf({})),
      },
      new AbortController().signal,
    ))
      out.push(t);
    expect(out.at(-1)).toEqual({ kind: "tool", name: "offerTimes", args: {} });
    expect(
      out
        .filter((t) => t.kind === "text")
        .map((t) => (t as { text: string }).text)
        .join(""),
    ).toBe("Let me find a time.");
  });
});
