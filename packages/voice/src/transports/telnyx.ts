/**
 * Telnyx media streaming: the phone network's audio over a WebSocket, both ways, and Call Control
 * over REST for transfer, hang-up and dial. Written against Telnyx's docs (media streaming and
 * Call Control v2) and left unconfigured: no account, key or number until setup.
 *
 * In: `connected`, `start` (the call control id, PCMU 8 kHz), `media` (base64 audio, inbound
 * track), `dtmf`, `stop`. Out: `media` with base64 PCMU, `clear` to drop what hasn't played.
 * Telnyx doesn't say when our audio played, so the transport counts it: PCMU is 8000 bytes a
 * second, so played is the first frame out and idle is when the last should have finished.
 *
 * From, to and direction ride in `client_state` (base64 JSON), set when we answer or dial.
 */
import type { CallStart, Direction, Frame, Incoming, Outgoing, Transport } from "../types.js";

/** The socket the box server hands over, one per call. */
export interface MediaSocket {
  send(text: string): void;
  close(): void;
  onMessage(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
}

/** Call Control, as a call needs it. */
export interface TelnyxControl {
  transfer(callControlId: string, to: string): Promise<void>;
  hangup(callControlId: string): Promise<void>;
  /** Dials out with the media stream on; returns the call control id. Never called before `mayDial`. */
  dial(o: {
    from: string;
    to: string;
    streamUrl: string;
    clientState: string;
    connectionId: string;
  }): Promise<string>;
}

const API = "https://api.telnyx.com/v2";

/** Call Control over HTTPS. The key comes from the box's env at setup; nothing passes one yet. */
export class TelnyxHttp implements TelnyxControl {
  constructor(private readonly apiKey: string) {}

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`telnyx ${path}: ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async transfer(id: string, to: string) {
    await this.post(`/calls/${encodeURIComponent(id)}/actions/transfer`, { to });
  }

  async hangup(id: string) {
    await this.post(`/calls/${encodeURIComponent(id)}/actions/hangup`, {});
  }

  async dial(o: {
    from: string;
    to: string;
    streamUrl: string;
    clientState: string;
    connectionId: string;
  }) {
    const r = await this.post("/calls", {
      connection_id: o.connectionId,
      from: o.from,
      to: o.to,
      stream_url: o.streamUrl,
      stream_track: "inbound_track",
      stream_bidirectional_mode: "rtp",
      stream_bidirectional_codec: "PCMU",
      client_state: o.clientState,
    });
    const id = (r.data as { call_control_id?: unknown } | undefined)?.call_control_id;
    if (typeof id !== "string") throw new Error("telnyx dial: no call control id");
    return id;
  }
}

/** What we put in `client_state`, and read back on `start`. */
export const clientStateOf = (o: { from: string; to: string; direction: Direction }) =>
  Buffer.from(JSON.stringify(o)).toString("base64");

function readState(b64: unknown): Partial<CallStart> {
  if (typeof b64 !== "string" || !b64) return {};
  try {
    const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    const d = s(j.direction);
    return {
      ...(s(j.from) !== undefined && { from: s(j.from) as string }),
      ...(s(j.to) !== undefined && { to: s(j.to) as string }),
      ...((d === "inbound" || d === "outbound") && { direction: d }),
    };
  } catch {
    return {};
  }
}

/** One Telnyx message as the session's events (none for the ones it doesn't need). */
export function incomingOf(raw: string): Incoming[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }
  const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  switch (m.event) {
    case "start": {
      const s = o(m.start);
      const id = typeof s.call_control_id === "string" ? s.call_control_id : "";
      const st = readState(s.client_state);
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      return [
        {
          kind: "start",
          call: {
            id,
            from: st.from ?? str(s.from),
            to: st.to ?? str(s.to),
            direction: st.direction ?? "inbound",
          },
        },
      ];
    }
    case "media": {
      const md = o(m.media);
      if (md.track !== undefined && md.track !== "inbound") return [];
      if (typeof md.payload !== "string") return [];
      const data = new Uint8Array(Buffer.from(md.payload, "base64"));
      return [{ kind: "audio", frame: { encoding: "pcmu", rate: 8000, data } }];
    }
    case "dtmf": {
      const digit = o(m.dtmf).digit;
      return typeof digit === "string" ? [{ kind: "key", digit }] : [];
    }
    case "stop":
      return [{ kind: "hangup" }];
    default:
      return [];
  }
}

// G.711 mu-law, for a mouth that speaks 16-bit PCM.
const BIAS = 0x84;
const CLIP = 32635;
export function muLaw(sample: number): number {
  let s = Math.max(-CLIP, Math.min(CLIP, sample | 0));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

export function muLawDecode(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exp = (u >> 4) & 0x07;
  const mant = u & 0x0f;
  const s = (((mant << 3) + BIAS) << exp) - BIAS;
  return sign ? -s : s;
}

/** Any frame as PCMU 8 kHz: as is, or 16-bit little-endian PCM resampled and encoded. */
export function toPcmu(f: Frame): Uint8Array {
  if (f.encoding === "pcmu") return f.data;
  if (f.encoding !== "pcm16") throw new Error(`can't send ${f.encoding} audio to a phone`);
  const view = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
  const n = Math.floor(f.data.byteLength / 2);
  const ratio = f.rate / 8000;
  const out = new Uint8Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const b = Math.min(n - 1, a + 1);
    const t = x - a;
    const s = view.getInt16(a * 2, true) * (1 - t) + view.getInt16(b * 2, true) * t;
    out[i] = muLaw(s);
  }
  return out;
}

export class TelnyxTransport implements Transport {
  readonly name: string = "telnyx";
  readonly carries = "audio" as const;
  readonly endpointing = "ours" as const;
  private id = "";
  private turn = -1;
  /** When what we sent should finish playing, by the clock. */
  private playEnd = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private on: (e: Incoming) => void = () => {};

  constructor(
    private readonly socket: MediaSocket,
    private readonly control: TelnyxControl,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  async open(on: (e: Incoming) => void): Promise<void> {
    this.on = on;
    this.socket.onMessage((raw) => {
      for (const e of incomingOf(raw)) {
        if (e.kind === "start") this.id = e.call.id;
        on(e);
      }
    });
    this.socket.onClose(() => on({ kind: "hangup" }));
  }

  send(out: Outgoing): void {
    if (out.kind !== "audio") return;
    const data = toPcmu(out.frame);
    this.socket.send(
      JSON.stringify({ event: "media", media: { payload: Buffer.from(data).toString("base64") } }),
    );
    const now = this.clock();
    if (out.turn !== this.turn || this.playEnd < now) {
      if (out.turn !== this.turn) {
        this.turn = out.turn;
        this.on({ kind: "played", turn: out.turn });
      }
      this.playEnd = Math.max(this.playEnd, now);
    }
    this.playEnd += (data.byteLength / 8000) * 1000;
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      this.on({ kind: "idle" });
    }, this.playEnd - now);
  }

  clear(): void {
    this.socket.send(JSON.stringify({ event: "clear" }));
    this.playEnd = 0;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  async transfer(to: string): Promise<void> {
    await this.control.transfer(this.id, to);
  }

  async hangup(): Promise<void> {
    if (this.idle) clearTimeout(this.idle);
    if (this.id) await this.control.hangup(this.id);
    this.socket.close();
  }
}
