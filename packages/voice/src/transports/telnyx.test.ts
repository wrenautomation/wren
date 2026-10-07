import { describe, expect, it } from "vitest";
import type { Incoming } from "../types.js";
import {
  clientStateOf,
  incomingOf,
  type MediaSocket,
  muLaw,
  muLawDecode,
  type TelnyxControl,
  TelnyxTransport,
  toPcmu,
} from "./telnyx.js";

describe("Telnyx media stream", () => {
  it("reads start, media, dtmf and stop", () => {
    const state = clientStateOf({
      from: "+15555550123",
      to: "+15555550100",
      direction: "outbound",
    });
    expect(
      incomingOf(
        JSON.stringify({
          event: "start",
          start: {
            call_control_id: "v3:abc",
            client_state: state,
            media_format: { encoding: "PCMU" },
          },
        }),
      ),
    ).toEqual([
      {
        kind: "start",
        call: { id: "v3:abc", from: "+15555550123", to: "+15555550100", direction: "outbound" },
      },
    ]);
    const [audio] = incomingOf(
      JSON.stringify({
        event: "media",
        media: { track: "inbound", payload: Buffer.from([1, 2, 255]).toString("base64") },
      }),
    );
    expect(audio).toEqual({
      kind: "audio",
      frame: { encoding: "pcmu", rate: 8000, data: new Uint8Array([1, 2, 255]) },
    });
    expect(
      incomingOf(JSON.stringify({ event: "media", media: { track: "outbound", payload: "AA==" } })),
    ).toEqual([]);
    expect(incomingOf(JSON.stringify({ event: "dtmf", dtmf: { digit: "5" } }))).toEqual([
      { kind: "key", digit: "5" },
    ]);
    expect(incomingOf(JSON.stringify({ event: "stop" }))).toEqual([{ kind: "hangup" }]);
    expect(incomingOf("not json")).toEqual([]);
    expect(incomingOf(JSON.stringify({ event: "connected" }))).toEqual([]);
  });

  it("encodes mu-law both ways within its step", () => {
    for (const s of [0, 100, -100, 1000, -5000, 32000, -32000]) {
      const back = muLawDecode(muLaw(s));
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(8, Math.abs(s) / 16));
    }
  });

  it("resamples 16 kHz PCM to 8 kHz PCMU", () => {
    const pcm = new Uint8Array(320 * 2); // 20 ms at 16 kHz
    expect(toPcmu({ encoding: "pcm16", rate: 16000, data: pcm }).length).toBe(160);
    expect(() => toPcmu({ encoding: "fake", rate: 0, data: pcm })).toThrow();
  });

  it("sends media and clear, counts play time, and transfers by call control id", async () => {
    const sent: string[] = [];
    let onMsg: (t: string) => void = () => {};
    const socket: MediaSocket = {
      send: (t) => sent.push(t),
      close: () => {},
      onMessage: (fn) => {
        onMsg = fn;
      },
      onClose: () => {},
    };
    const calls: string[] = [];
    const control: TelnyxControl = {
      transfer: async (id, to) => void calls.push(`transfer ${id} ${to}`),
      hangup: async (id) => void calls.push(`hangup ${id}`),
      dial: async () => "x",
    };
    const t = new TelnyxTransport(socket, control);
    const events: Incoming[] = [];
    await t.open((e) => events.push(e));
    onMsg(JSON.stringify({ event: "start", start: { call_control_id: "v3:abc" } }));
    t.send({
      kind: "audio",
      frame: { encoding: "pcmu", rate: 8000, data: new Uint8Array(80) },
      turn: 1,
    });
    expect(JSON.parse(sent[0] as string)).toEqual({
      event: "media",
      media: { payload: Buffer.alloc(80).toString("base64") },
    });
    expect(events.map((e) => e.kind)).toEqual(["start", "played"]);
    await new Promise((ok) => setTimeout(ok, 30)); // 80 bytes = 10 ms
    expect(events.at(-1)?.kind).toBe("idle");
    t.clear();
    expect(JSON.parse(sent.at(-1) as string)).toEqual({ event: "clear" });
    await t.transfer("+15555550100");
    await t.hangup();
    expect(calls).toEqual(["transfer v3:abc +15555550100", "hangup v3:abc"]);
  });
});
