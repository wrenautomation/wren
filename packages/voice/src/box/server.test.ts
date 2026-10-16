import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentOf } from "../agent.js";
import type { CallResult } from "../call.js";
import { FakeEars, fakePorts, ScriptedBrain } from "../fakes.js";
import type { Frame, Mouth } from "../types.js";
import { startVoiceServer } from "./server.js";
import { acceptKey } from "./ws.js";

/** 20 ms of 16 kHz silence a word, as a vendor's mouth would send PCM. */
const pcmMouth: Mouth = {
  name: "pcm",
  async *speak(text: string): AsyncIterable<Frame> {
    for (const _ of text.split(" "))
      yield { encoding: "pcm16", rate: 16000, data: new Uint8Array(640) };
  },
};

const control = { transfer: async () => {}, hangup: async () => {}, dial: async () => "x" };
const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()?.();
});

async function serve(o: { token: string | null; ready: boolean; saved?: CallResult[] }) {
  const server = await startVoiceServer({
    port: 0,
    token: o.token,
    control,
    pipeline: (transport) =>
      o.ready
        ? { transport, ears: new FakeEars(), brain: new ScriptedBrain(), mouth: pcmMouth }
        : null,
    agent: async () => agentOf({}),
    ports: fakePorts(),
    save: async (r) => void o.saved?.push(r),
  });
  closers.push(() => server.close());
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("the voice box server", () => {
  it("computes the handshake key as RFC 6455 says", () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("is not ready, and refuses calls, until setup", async () => {
    const at = await serve({ token: null, ready: false });
    const health = await fetch(`http://${at}/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ready: false, calls: 0 });
    const ws = new WebSocket(`ws://${at}/media?token=x`);
    const closed = await new Promise<string>((ok) => {
      ws.onerror = () => ok("error");
      ws.onopen = () => ok("open");
    });
    expect(closed).toBe("error");
  });

  it("runs a call on the media socket and saves it", async () => {
    const saved: CallResult[] = [];
    const at = await serve({ token: "t0k", ready: true, saved });
    expect((await fetch(`http://${at}/health`)).status).toBe(200);
    const ws = new WebSocket(`ws://${at}/media?token=t0k`);
    const got: string[] = [];
    await new Promise<void>((ok) => {
      ws.onopen = () => ok();
    });
    ws.onmessage = (m) => got.push(String(m.data));
    ws.send(JSON.stringify({ event: "start", start: { call_control_id: "v3:test" } }));
    // Wait for the opener's frames, then the save, not a fixed time: a loaded runner is slow.
    const frames = () => got.filter((m) => JSON.parse(m).event === "media").length;
    const until = { timeout: 60_000, interval: 20 };
    await vi.waitFor(() => expect(frames()).toBeGreaterThan(3), until);
    ws.send(JSON.stringify({ event: "stop" }));
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0), until);
    ws.close();
    expect(saved[0]?.call.id).toBe("v3:test");
    expect(saved[0]?.outcome).toBe("hung_up");
    // The opener went out as PCMU, 160 bytes a 20 ms frame.
    const media = got.map((m) => JSON.parse(m)).filter((m) => m.event === "media");
    expect(media.length).toBeGreaterThan(3);
    expect(Buffer.from(media[0].media.payload, "base64").length).toBe(160);
  });
});
