import { describe, expect, it, vi } from "vitest";

const query = vi.fn((o: unknown) => o);
vi.mock("@anthropic-ai/claude-agent-sdk/browser", () => ({ query }));

const { openSetup, turns } = await import("./connect.js");

describe("agent connect", () => {
  it("queues turns until said, ends after the queue drains", async () => {
    const t = turns();
    const next = t.stream[Symbol.asyncIterator]();
    const first = next.next();
    t.say("one");
    t.say("two");
    t.end();
    expect((await first).value.message.content).toBe("one");
    expect((await next.next()).value.message.content).toBe("two");
    expect((await next.next()).done).toBe(true);
  });

  it("opens the setup's relay path with the local token as the auth frame", async () => {
    await openSetup({
      setup: "bird watch",
      token: "tok",
      prompt: turns().stream,
      canUseTool: async () => ({ behavior: "deny", message: "no" }),
      resume: "s/1",
    });
    const o = query.mock.calls[0]?.[0] as {
      websocket: { url: string; authMessage: unknown };
    };
    expect(o.websocket.url).toBe("ws://127.0.0.1:4748/s/bird%20watch?resume=s%2F1");
    expect(o.websocket.authMessage).toEqual({
      type: "auth",
      credential: { type: "oauth", token: "tok" },
    });
  });
});
