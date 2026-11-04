// Fixtures: one real relay session each, trimmed (ids and paths made up).
import { describe, expect, it } from "vitest";
import { turnContent } from "./files.js";
import birdwatch from "./fixtures/birdwatch.json" with { type: "json" };
import stored from "./fixtures/history.json" with { type: "json" };
import prompt from "./fixtures/prompt.json" with { type: "json" };
import stop from "./fixtures/stop.json" with { type: "json" };
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
const frames = (f: { frames: unknown[] }) => f.frames as Frame[];

/** Plays a session as the page does: each turn said, then its frames to the result. */
function play(f: Frame[], turns: string[], step?: (s: ThreadState, f: Frame) => ThreadState) {
  let s = EMPTY;
  let t = 0;
  let open = false;
  for (const x of f) {
    if (!open && x.type !== "system") {
      s = said(s, turns[t++] ?? "");
      open = true;
    }
    s = (step ?? fold)(s, x);
    if (x.type === "result") open = false;
  }
  return s;
}

describe("fold", () => {
  it("two turns: words, then a tool call with its result, then words; each with a foot", () => {
    const s = play(frames(birdwatch), ["Reply OK only.", "Use Bash to run date."]);
    expect(s.running).toBe(false);
    expect(s.session).toMatch(/^0000/);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const [, one, , two] = s.messages;
    expect(one?.parts).toEqual([{ type: "text", text: "OK" }]);
    expect(one?.state).toBe("done");
    expect(one?.foot?.model).toBe("claude-sonnet-5-5");
    expect(
      (one?.foot?.input ?? 0) + (one?.foot?.cacheRead ?? 0) + (one?.foot?.cacheWrite ?? 0),
    ).toBeGreaterThan(5000);
    expect(one?.foot?.output).toBeGreaterThan(0);
    expect(one?.foot?.cost).toBeGreaterThan(0);
    const tool = two?.parts[0];
    expect(tool).toMatchObject({ type: "tool", name: "Bash", input: { command: "date" } });
    expect(tool?.type === "tool" && tool.result).toMatch(/2026/);
    expect(tool?.type === "tool" && tool.inputText).toBeUndefined();
    expect(two?.parts[1]).toMatchObject({ type: "text" });
    expect(two?.parts).toHaveLength(2);
  });

  it("streams: the reply grows word by word before the whole frame lands", () => {
    const f = frames(birdwatch);
    const upTo = f.findIndex((x, i) => i > 30 && x.type === "assistant");
    const s = play(f.slice(0, upTo), ["a", "b"]);
    const last = s.messages.at(-1);
    expect(last?.state).toBe("live");
    expect(s.running).toBe(true);
    const text = last?.parts.at(-1);
    expect(text?.type === "text" && text.text.length).toBeGreaterThan(0);
  });

  it("an ask lands on its tool card; a no shows as the tool's failed result", () => {
    const p = prompt.prompts[0] as {
      id: string;
      name: string;
      input: Record<string, unknown>;
      why: string;
    };
    const s = play(frames(prompt), ["touch it"], (s, x) => {
      const n = fold(s, x);
      // the CLI asks right after the tool's whole frame
      return x.type === "assistant" && JSON.stringify(x).includes(p.id) ? asked(n, p) : n;
    });
    const reply = s.messages[1];
    const tool = reply?.parts.find((x) => x.type === "tool");
    expect(tool).toMatchObject({ id: p.id, ask: { why: p.why, allowed: false }, failed: true });
    expect(reply?.parts.at(-1)).toMatchObject({ type: "text" });
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
    const s = play(frames(stop), ["essay"]);
    const reply = s.messages[1];
    expect(reply?.state).toBe("stopped");
    expect(s.running).toBe(false);
    expect(reply?.parts.some((x) => x.type === "text")).toBe(true);
    // the signed-only thinking block stays, empty: the part draws nothing once done
    expect(s.messages).toHaveLength(2);
  });

  it("a stored session: its own turns, the tool result on its card, no foot", () => {
    const s = history(stored as Frame[]);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(s.messages[0]?.parts).toEqual([{ type: "text", text: "Reply OK only." }]);
    expect(s.messages[0]?.at).toMatch(/^2026-/);
    const tool = s.messages[3]?.parts[0];
    expect(tool).toMatchObject({
      type: "tool",
      name: "Bash",
      result: expect.stringMatching(/2026/),
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

  it("cut ends a live reply: failed, or stopped after Stop", () => {
    const live = said(EMPTY, "x");
    expect(cut(live).messages[1]?.state).toBe("failed");
    expect(cut({ ...live, stopping: true }).messages[1]?.state).toBe("stopped");
    expect(cut(EMPTY)).toEqual({ ...EMPTY, running: false });
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
  );

  it("words first, then the page line, then each file's line and block", () => {
    expect(wire.map((b) => (b.type === "text" ? b.text : b.type))).toEqual([
      "What is in these?",
      "[Page: Research › Ask (/research/ask)]",
      "[Attached: shot.png]",
      "image",
      "[Attached: /u/ab/1/clip.mp4]",
    ]);
  });

  it("a stored turn reads back as words, file parts and the page", () => {
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
    [new Error("WebSocket connection error"), /isn't running/, true],
    [closed(4401, "not your session"), /someone else/, false],
    [closed(4401, "not allowed to open this setup"), /don't have access/, false],
    [closed(4403, "credential"), /credential/, false],
    [closed(4404), /doesn't exist/, false],
    [closed(4400, "connection terminal is not built (WA-1051)"), /terminal is not built/, false],
    [closed(4429), /Too many/, true],
    [closed(4500, "claude exit 1"), /unexpectedly/, true],
    [closed(1006), /closed/, true],
  ])("%s", (e, text, retry) => {
    const c = closeText(e);
    expect(c.text).toMatch(text);
    expect(c.retry).toBe(retry);
  });
});
