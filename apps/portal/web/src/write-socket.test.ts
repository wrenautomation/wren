/** The tab's socket to its `WriteWatch`: what it hears goes to `WRITES`, a dead one is noticed. */
import type { WireState } from "@wren/ui";
import { describe, expect, it } from "vitest";
import {
  newsOf,
  PING_MS,
  PONG_MS,
  type SocketLike,
  WRITES_PROTOCOL,
  WriteSocket,
} from "./write-socket.js";

function fake() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const sockets: (SocketLike & {
    url: string;
    protocols: string[];
    sent: string[];
    closed: boolean;
  })[] = [];
  const heard: [string, WireState][] = [];
  const pushed: boolean[] = [];
  const s = new WriteSocket({
    url: "wss://app.example.test/api/live/writes",
    token: async () => "tok",
    open: (url, protocols) => {
      const ws = {
        url,
        protocols,
        sent: [] as string[],
        closed: false,
        onopen: null,
        onmessage: null,
        onclose: null,
        send(d: string) {
          this.sent.push(d);
        },
        close() {
          this.closed = true;
        },
      };
      sockets.push(ws);
      return ws;
    },
    writes: {
      heard: (rid, st) => void heard.push([rid, st]),
      pushed: (on) => void pushed.push(on),
    },
    timer: {
      set: (fn, ms) => {
        timers.set(++id, { fn, ms });
        return id;
      },
      clear: (t) => void timers.delete(t as number),
    },
  });
  /** Run the timer due in `ms`. */
  const fire = (ms: number) => {
    const hit = [...timers].find(([, t]) => t.ms === ms);
    if (!hit) throw new Error(`no timer at ${ms}`);
    timers.delete(hit[0]);
    hit[1].fn();
  };
  return { s, sockets, heard, pushed, timers, fire };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("newsOf", () => {
  it("takes write states only", () => {
    expect(
      newsOf('{"type":"write","requestId":"r1","state":{"state":"sent","answer":null}}'),
    ).toEqual({ requestId: "r1", state: { state: "sent", answer: null } });
    expect(newsOf("pong")).toBeNull();
    expect(newsOf('{"type":"write","requestId":"r1","state":{"state":"odd"}}')).toBeNull();
    expect(newsOf("{not json")).toBeNull();
  });
});

describe("WriteSocket", () => {
  it("signs in through the protocol, tells WRITES it's open, and hands on each state", async () => {
    const f = fake();
    f.s.start();
    await settle();
    const ws = f.sockets[0];
    expect(ws?.protocols).toEqual([WRITES_PROTOCOL, "tok"]);
    ws?.onopen?.(null);
    expect(f.pushed).toEqual([true]);
    ws?.onmessage?.({
      data: JSON.stringify({
        type: "write",
        path: "inbox/reply",
        requestId: "r1",
        state: { state: "sending", retry: { count: 1, reason: "LinkedIn answered 429." } },
      }),
    });
    expect(f.heard).toEqual([
      ["r1", { state: "sending", retry: { count: 1, reason: "LinkedIn answered 429." } }],
    ]);
  });

  it("closes a socket that stops answering pings, falls back to asking, and connects again", async () => {
    const f = fake();
    f.s.start();
    await settle();
    const ws = f.sockets[0];
    ws?.onopen?.(null);
    f.fire(PING_MS);
    expect(ws?.sent).toEqual(["ping"]);
    f.fire(PONG_MS);
    expect(ws?.closed).toBe(true);
    expect(f.pushed).toEqual([true, false]);
    // Back off, then a new socket.
    f.fire(1000);
    await settle();
    expect(f.sockets).toHaveLength(2);
  });

  it("keeps the socket while pongs come back", async () => {
    const f = fake();
    f.s.start();
    await settle();
    const ws = f.sockets[0];
    ws?.onopen?.(null);
    f.fire(PING_MS);
    ws?.onmessage?.({ data: "pong" });
    expect([...f.timers.values()].some((t) => t.ms === PONG_MS)).toBe(false);
    expect(ws?.closed).toBe(false);
  });
});
