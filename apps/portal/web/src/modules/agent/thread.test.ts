// Tapes: real relay sessions, scrubbed (`packages/agent/scripts/scrub-tape.mjs`); the stories play the same ones
import { describe, expect, it } from "vitest";
import stored from "../../mocks/data/agent/history.json" with { type: "json" };
import stop from "../../mocks/data/agent/stop.json" with { type: "json" };
import work from "../../mocks/data/agent/work.json" with { type: "json" };
import { turnContent } from "./files.js";
import {
  answered,
  asked,
  closeText,
  cut,
  EMPTY,
  fold,
  history,
  said,
  storedTurn,
  type ThreadState,
} from "./thread.js";

type Frame = Record<string, unknown> & { type?: string };
type Tape = { t: number; from: string; frame: Frame }[];
type Ask = {
  request_id: string;
  request: {
    subtype: string;
    tool_name: string;
    input: Record<string, unknown>;
    tool_use_id?: string;
  };
};

/** Plays a tape as the page does: its turns said, the CLI's frames folded, asks and answers on their cards. */
function play(tape: Tape) {
  let s = EMPTY;
  const asks = new Map<string, string>();
  for (const { from, frame } of tape) {
    if (from === "page" && frame.type === "user") {
      const m = frame.message as { content: string };
      s = said(s, m.content);
    } else if (from === "cli" && frame.type === "control_request") {
      const { request_id, request: r } = frame as unknown as Ask;
      if (r.subtype !== "can_use_tool" || !r.tool_use_id) continue;
      asks.set(request_id, r.tool_use_id);
      s = asked(s, { id: r.tool_use_id, name: r.tool_name, input: r.input });
    } else if (from === "page" && frame.type === "control_response") {
      const r = frame.response as {
        request_id: string;
        response?: { behavior?: string; updatedInput?: { answers?: Record<string, string> } };
      };
      const id = asks.get(r.request_id);
      if (id)
        s = answered(s, id, r.response?.behavior === "allow", r.response?.updatedInput?.answers);
    } else if (from === "cli" && frame.type !== "control_response") s = fold(s, frame);
  }
  return s;
}

const tool = (s: ThreadState, name: string) =>
  s.messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.name === name);

describe("fold", () => {
  it("a working turn: tools with their results, an answered ask, then words; each reply with a foot", () => {
    const s = play(work as Tape);
    expect(s.running).toBe(false);
    expect(s.session).toMatch(/^0000/);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const [, one, , two] = s.messages;
    expect(one?.state).toBe("done");
    expect(one?.foot?.model).toBe("claude-sonnet-5-5");
    expect(
      (one?.foot?.input ?? 0) + (one?.foot?.cacheRead ?? 0) + (one?.foot?.cacheWrite ?? 0),
    ).toBeGreaterThan(5000);
    expect(one?.foot?.output).toBeGreaterThan(0);
    expect(one?.foot?.cost).toBeGreaterThan(0);
    const bash = tool(s, "Bash");
    expect(bash).toMatchObject({ input: { command: expect.stringMatching(/^printf/) } });
    expect(bash?.type === "tool" && bash.result).toMatch(/northwind\.example 200/);
    expect(bash?.type === "tool" && bash.inputText).toBeUndefined();
    expect(tool(s, "Skill")).toMatchObject({
      input: { skill: expect.stringMatching(/weaver/) },
    });
    expect(tool(s, "AskUserQuestion")).toMatchObject({
      ask: { allowed: true },
      answers: { "Which site should be read first?": expect.any(String) },
    });
    expect(one?.parts.at(-1)).toMatchObject({ type: "text" });
    expect(two?.parts).toEqual([{ type: "text", text: expect.stringMatching(/42/) }]);
  });

  it("streams: the reply grows word by word before the whole frame lands", () => {
    const t = work as Tape;
    const words = t.findIndex(
      (x) => x.frame.type === "stream_event" && JSON.stringify(x.frame).includes("text_delta"),
    );
    const whole = t.findIndex((x, i) => i > words && x.frame.type === "assistant");
    const s = play(t.slice(0, whole));
    const last = s.messages.at(-1);
    expect(last?.state).toBe("live");
    expect(s.running).toBe(true);
    const text = last?.parts.at(-1);
    expect(text?.type === "text" && text.text.length).toBeGreaterThan(0);
  });

  it("a no shows on the ask's card", () => {
    let s = said(EMPTY, "touch it");
    s = asked(s, { id: "t1", name: "Bash", input: { command: "touch x" }, why: "writes a file" });
    s = answered(s, "t1", false);
    expect(s.messages[1]?.parts[0]).toMatchObject({
      ask: { why: "writes a file", allowed: false },
    });
  });

  it("answered marks the ask once", () => {
    let s = said(EMPTY, "go");
    s = asked(s, { id: "t1", name: "Bash", input: { command: "ls" }, why: "check" });
    expect(s.messages[1]?.parts[0]).toMatchObject({ ask: { why: "check" } });
    s = answered(s, "t1", true);
    expect(s.messages[1]?.parts[0]).toMatchObject({ ask: { allowed: true } });
    expect(answered(s, "nope", false)).toBe(s);
  });

  it("answered keeps AskUserQuestion's picks on its part", () => {
    let s = said(EMPTY, "go");
    const input = {
      questions: [{ question: "Which list?", options: [{ label: "A" }, { label: "B" }] }],
    };
    s = asked(s, { id: "q1", name: "AskUserQuestion", input });
    s = answered(s, "q1", true, { "Which list?": "B" });
    expect(s.messages[1]?.parts[0]).toMatchObject({
      ask: { allowed: true },
      answers: { "Which list?": "B" },
    });
  });

  it("Stop: the interrupt marker and the error result read as stopped, not failed", () => {
    const s = play(stop as Tape);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const [, one, , two] = s.messages;
    expect(one?.state).toBe("stopped");
    expect(one?.parts.some((x) => x.type === "text")).toBe(true);
    // the next turn runs as usual
    expect(two?.state).toBe("done");
    expect(two?.parts.at(-1)).toMatchObject({ type: "text", text: expect.stringMatching(/42/) });
    expect(s.running).toBe(false);
  });

  it("a stored session: its own turns, the tool result on its card, no foot", () => {
    const s = history(stored as Frame[]);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(s.messages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/^A test of the chat page/),
    });
    expect(s.messages[0]?.at).toMatch(/^2026-/);
    expect(tool(s, "Bash")).toMatchObject({
      result: expect.stringMatching(/northwind\.example 200/),
    });
    expect(s.messages.every((m) => m.state !== "live")).toBe(true);
    expect(s.running).toBe(false);
  });

  it("a stored reply's foot sums usage once per API message", () => {
    const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000 };
    const a = (id: string, content: unknown[]) => ({
      type: "assistant",
      message: { id, model: "claude-haiku-5-5", role: "assistant", content, usage: u },
    });
    const s = history([
      { type: "user", message: { role: "user", content: "Hi" } },
      a("m1", [{ type: "thinking", thinking: "", signature: "x" }]),
      a("m1", [{ type: "text", text: "Hello" }]),
      a("m2", [{ type: "text", text: "again" }]),
      { type: "assistant", message: { id: "m3", model: "<synthetic>", content: [], usage: u } },
    ] as Frame[]);
    expect(s.messages[1]?.foot).toMatchObject({
      input: 20,
      output: 10,
      cacheRead: 2000,
      model: "claude-haiku-5-5",
    });
  });

  it("shows a typed command's answer, never the line after a stop", () => {
    const cli = (text: string) => ({
      type: "assistant",
      message: { id: text, model: "<synthetic>", content: [{ type: "text", text }] },
    });
    const s = history([
      { type: "user", message: { role: "user", content: "/context" } },
      cli("## Context Usage"),
      { type: "user", message: { role: "user", content: "Go on" } },
      cli("No response requested."),
    ] as Frame[]);
    const said = s.messages.flatMap((m) => m.parts.map((p) => ("text" in p ? p.text : "")));
    expect(said).toContain("## Context Usage");
    expect(said).not.toContain("No response requested.");
  });

  it("cut ends a live reply: failed, or stopped after Stop", () => {
    const live = said(EMPTY, "x");
    expect(cut(live).messages[1]?.state).toBe("failed");
    expect(cut({ ...live, stopping: true }).messages[1]?.state).toBe("stopped");
    expect(cut(EMPTY)).toEqual({ ...EMPTY, running: false });
  });
});

describe("what a call cost", () => {
  const usage = (input: number, write: number, read: number, output: number) => ({
    input_tokens: input,
    cache_creation_input_tokens: write,
    cache_read_input_tokens: read,
    output_tokens: output,
  });
  const call = (id: string, tool: Record<string, unknown>, u: Record<string, number>): Frame => ({
    type: "assistant",
    message: { id, model: "claude-haiku-5-5", content: [{ type: "tool_use", ...tool }], usage: u },
  });
  const result = (id: string, text: string, extra: Record<string, unknown> = {}): Frame => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] },
    ...extra,
  });
  const byId = (s: ThreadState, id: string) =>
    s.messages.at(-1)?.parts.find((p) => p.type === "tool" && p.id === id);

  it("a skill counts what the next call's prompt grew by", () => {
    let s = said(EMPTY, "tidy this");
    s = fold(
      s,
      call(
        "m1",
        { id: "k1", name: "Skill", input: { skill: "humanizer" } },
        usage(2, 14441, 11382, 17),
      ),
    );
    s = fold(s, result("k1", "Launching skill: humanizer"));
    expect(byId(s, "k1")).not.toHaveProperty("tokens");
    s = fold(s, {
      type: "assistant",
      message: {
        id: "m2",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: "ok" }],
        usage: usage(2, 11822, 25823, 4),
      },
    });
    // 37647 in the second prompt, 25842 in the first call's prompt and output
    expect(byId(s, "k1")).toMatchObject({ tokens: 11805 });
  });

  it("a subagent's count comes from its result", () => {
    let s = said(EMPTY, "read the sites");
    s = fold(
      s,
      call(
        "m1",
        { id: "g1", name: "Agent", input: { description: "Read sites" } },
        usage(5, 0, 900, 40),
      ),
    );
    s = fold(
      s,
      result("g1", "Nine read.", {
        tool_use_result: { totalTokens: 48200, totalToolUseCount: 23 },
      }),
    );
    expect(byId(s, "g1")).toMatchObject({ tokens: 48200, uses: 23 });
  });
});

describe("a product's card", () => {
  const call = (id: string, command: string): Frame => ({
    type: "assistant",
    message: {
      id: `m-${id}`,
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
    },
  });
  const result = (id: string, text: string): Frame => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] },
  });
  const step = (run: string) =>
    `${run} 1.read ok\n::view research.run {"run":"${run}"}\n{"run":"${run}"}`;
  const kinds = (s: ThreadState) =>
    s.messages
      .at(-1)
      ?.parts.map((p) => (p.type === "view" ? `${p.name} ${JSON.stringify(p.data)}` : p.type));

  it("a view line in a tool's output becomes a view part after it", () => {
    let s = said(EMPTY, "read this reel");
    s = fold(s, call("t1", "weaver open --lines reel.txt"));
    s = fold(s, result("t1", step("r1")));
    expect(kinds(s)).toEqual(["tool", 'research.run {"run":"r1"}']);
  });

  it("one card a run in a reply: the next step moves it under itself", () => {
    let s = said(EMPTY, "read this reel");
    s = fold(s, call("t1", "weaver open --lines reel.txt"));
    s = fold(s, result("t1", step("r1")));
    s = fold(s, call("t2", "weaver add edge r1 stop --why asked"));
    s = fold(s, result("t2", step("r1")));
    s = fold(s, call("t3", "weaver brief r2"));
    s = fold(s, result("t3", step("r2")));
    expect(kinds(s)).toEqual([
      "tool",
      "tool",
      'research.run {"run":"r1"}',
      "tool",
      'research.run {"run":"r2"}',
    ]);
  });

  it("reads the line from a numbered file read; words that only hold it draw nothing", () => {
    let s = said(EMPTY, "check the step");
    s = fold(s, call("t1", "cat out.txt"));
    s = fold(
      s,
      result(
        "t1",
        '     1\t::view research.run {"run":"r1"}\nsee ::view research.run {"run":"r9"}\n::view research.run not json',
      ),
    );
    expect(kinds(s)).toEqual(["tool", 'research.run {"run":"r1"}']);
  });
});

describe("files in a turn", () => {
  const png = { type: "base64", media_type: "image/png", data: "iVBO" };
  const wire = turnContent(
    "What is in these?",
    [
      {
        file: { name: "shot.png", kind: "image" },
        data: [
          { type: "text", text: "[Attached: shot.png]" },
          { type: "image", source: png },
        ],
      },
      {
        file: { name: "clip.mp4", kind: "video" },
        data: [{ type: "text", text: "[Attached: /u/ab/1/clip.mp4]" }],
      },
    ],
    "Research › Ask (/research/ask)",
    "00000000-0000-4000-8000-000000000001",
    "Leads: 12 rows",
  );

  it("words first, then the page and chat lines, then each file's line and block", () => {
    expect(wire.map((b) => (b.type === "text" ? b.text : b.type))).toEqual([
      "What is in these?",
      "[Page: Research › Ask (/research/ask)]",
      "[In view]\nLeads: 12 rows",
      "[Chat: 00000000-0000-4000-8000-000000000001]",
      "[Attached: shot.png]",
      "image",
      "[Attached: /u/ab/1/clip.mp4]",
    ]);
  });

  it("a stored turn reads back as words, file parts and the page; the chat and in-view lines stay hidden", () => {
    const t = storedTurn(wire);
    expect(t.words).toBe("What is in these?");
    expect(t.page).toBe("Research › Ask (/research/ask)");
    expect(t.parts).toEqual([
      { type: "text", text: "What is in these?" },
      {
        type: "file",
        file: { name: "shot.png", kind: "image", src: "data:image/png;base64,iVBO" },
      },
      { type: "file", file: { name: "clip.mp4", kind: "video" } },
    ]);
  });

  it("a turn of files only is kept; the live turn shows them", () => {
    const s = history([{ type: "user", message: { role: "user", content: wire.slice(2) } }]);
    expect(s.messages[0]?.parts.map((p) => p.type)).toEqual(["file", "file"]);
    const live = said(EMPTY, "", { files: [{ name: "a.pdf", kind: "pdf" }], page: "Home" });
    expect(live.messages[0]).toMatchObject({ parts: [{ type: "file" }], page: "Home" });
  });
});

describe("closeText", () => {
  const closed = (code: number, why = "") =>
    new Error(`WebSocket closed abnormally with code ${code}: ${why}`);
  it.each([
    [new Error("WebSocket connection error"), /isn't running/, true, undefined],
    [closed(4401, "not your session"), /someone else/, false, true],
    [closed(4401, "not allowed to open this setup"), /don't have access/, false, true],
    [closed(4403, "credential"), /credential/, false, true],
    [closed(4404), /doesn't exist/, false, true],
    // a pick can fix it: the box stays open
    [
      closed(4400, "connection terminal is not built (WA-1051)"),
      /terminal is not built/,
      false,
      undefined,
    ],
    [new Error("relay 404: code 404"), /Start a new chat/, false, true],
    [closed(4429), /Too many/, true, undefined],
    [closed(4500, "claude exit 1"), /unexpectedly/, true, undefined],
    [closed(1006), /closed/, true, undefined],
  ])("%s", (e, text, retry, lock) => {
    const c = closeText(e);
    expect(c.text).toMatch(text);
    expect(c.retry).toBe(retry);
    expect(c.lock).toBe(lock);
  });
});

describe("typed commands in a stored chat", () => {
  it("shows the command as typed, never its tags", () => {
    const tag = (name: string, args: string) =>
      `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>`;
    const s = history([
      { type: "user", message: { role: "user", content: tag("model", "sonnet") } },
      { type: "user", message: { role: "user", content: tag("context", "") } },
      {
        type: "user",
        message: {
          role: "user",
          content: "<local-command-stdout>Set model</local-command-stdout>",
        },
      },
    ]);
    const words = s.messages
      .filter((m) => m.role === "user")
      .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
    expect(words).toEqual(["/model sonnet", "/context"]);
  });
});

describe("compaction", () => {
  const compacts = (s: ThreadState) =>
    s.messages.flatMap((m) => m.parts.filter((p) => p.type === "compact"));

  it("live: compacting, then the boundary's numbers on the same mark", () => {
    let s = said(EMPTY, "/compact");
    s = fold(s, { type: "system", subtype: "status", status: "compacting" });
    expect(compacts(s)).toMatchObject([{ state: "live" }]);
    s = fold(s, { type: "system", subtype: "status", status: null, compact_result: "success" });
    s = fold(s, {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "manual", pre_tokens: 12419, post_tokens: 1246 },
    });
    s = fold(s, {
      type: "user",
      isSynthetic: true,
      message: { role: "user", content: "This session is being continued" },
    });
    expect(compacts(s)).toMatchObject([
      { state: "done", trigger: "manual", before: 12419, after: 1246 },
    ]);
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("live: a failed compaction says why", () => {
    let s = fold(EMPTY, { type: "system", subtype: "status", status: "compacting" });
    s = fold(s, {
      type: "system",
      subtype: "status",
      status: null,
      compact_result: "failed",
      compact_error: "Not enough messages to compact.",
    });
    expect(compacts(s)).toMatchObject([
      { state: "failed", error: "Not enough messages to compact." },
    ]);
  });

  it("stored: the turns before stay, the mark sits after /compact, the summary hides", () => {
    const user = (content: string, more = {}) => ({
      type: "user",
      message: { role: "user", content },
      ...more,
    });
    const s = history([
      user("Say apple"),
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Apple" }] } },
      {
        type: "system",
        subtype: "compact_boundary",
        compactMetadata: { trigger: "manual", preTokens: 900, postTokens: 90 },
      },
      user("This session is being continued", { isCompactSummary: true }),
      user("<local-command-caveat>Caveat</local-command-caveat>", { isMeta: true }),
      user(
        "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>",
      ),
      user("<local-command-stdout>Compacted </local-command-stdout>"),
      user("What word first?"),
    ]);
    const shown = s.messages.map((m) =>
      m.parts.map((p) => (p.type === "text" ? p.text : p.type)).join(" "),
    );
    expect(shown).toEqual(["Say apple", "Apple", "/compact", "compact", "What word first?", ""]);
    expect(compacts(s)).toMatchObject([{ before: 900, after: 90 }]);
  });
});
