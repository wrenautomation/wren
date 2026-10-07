/** The mic for dictation: 16 kHz mono slices and their loudness, until closed. */
import { DICTATION_RATE, levelOf, resample } from "@wren/voice/dictation";

export interface Mic {
  close(): void;
}

/** The browser's refusal, in words a person can act on. */
export function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The browser blocked the mic. Allow it for this site, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No mic found. Plug one in and try again.";
  if (name === "NotReadableError") return "Another app is using the mic.";
  return "The mic didn't start. Try again.";
}

export async function openMic(on: (samples: Float32Array, level: number) => void): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("no mic", "NotFoundError");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule("/dictate-mic.js");
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "dictate-mic");
    const rate = ctx.sampleRate;
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const s = rate === DICTATION_RATE ? e.data : resample(e.data, rate);
      on(s, levelOf(s));
    };
    source.connect(tap);
    if (ctx.state === "suspended") await ctx.resume();
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
    throw err;
  }
  return {
    close() {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
    },
  };
}
