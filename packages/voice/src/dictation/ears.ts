/**
 * Ears from any batch model (designs/2026-10-07-dictation.md). The audio is cut into segments on
 * a pause or at a length cap. While a segment grows, the model runs on it again for a partial,
 * one run at a time and never queued behind another; when the segment ends, one more run gives
 * its final. Every run is padded with silence: Moonshine drops last words without it.
 */
import type { EarStream, Ears, Frame, Heard } from "../types.js";
import { DICTATION_RATE, levelOf, samplesOf, type Transcriber } from "./transcriber.js";

export interface TranscriberEarsOptions {
  /** New audio a partial needs since the last run, in ms. Default 250; a server takes 1500. */
  partialEveryMs?: number;
  /** Quiet that ends a segment, ms. Default 700. */
  pauseMs?: number;
  /** A segment is cut here even mid-speech, ms. Default 20 s (Whisper hears 30 s at most). */
  maxSegmentMs?: number;
  /** Louder than this is speech, at the least (RMS, 0..1). Default 0.01. */
  floor?: number;
  /** Silence each run is wrapped in, ms. Default 300. */
  padMs?: number;
  /** A run failed: the words of that run are lost, the stream goes on. */
  onError?: (err: unknown) => void;
}

const ms = (n: number) => Math.round((n * DICTATION_RATE) / 1000);

export class TranscriberEars implements Ears {
  readonly name: string;
  constructor(
    private readonly model: Transcriber,
    private readonly o: TranscriberEarsOptions = {},
  ) {
    this.name = model.name;
  }

  open(on: (h: Heard) => void): EarStream {
    const model = this.model;
    const o = this.o;
    const every = ms(o.partialEveryMs ?? 250);
    const pause = ms(o.pauseMs ?? 700);
    const cap = ms(o.maxSegmentMs ?? 20_000);
    const preroll = ms(300);
    const pad = new Float32Array(ms(o.padMs ?? 300));
    const floor = o.floor ?? 0.01;

    let chunks: Float32Array[] = [];
    let length = 0;
    let speaking = false;
    let quiet = 0;
    /** Background loudness, so a fan doesn't count as talking. */
    let noise = floor / 2;
    let ranAt = 0;
    /** Bumped per segment: a partial from an old one is dropped. */
    let segment = 0;
    let running = false;
    let closed = false;
    let finals: Promise<void> = Promise.resolve();
    const abort = new AbortController();

    const joined = () => {
      const out = new Float32Array(pad.length * 2 + length);
      let at = pad.length;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    };
    const fail = (err: unknown) => {
      if (!abort.signal.aborted) o.onError?.(err);
    };

    const partial = () => {
      if (running || !speaking || length - ranAt < every) return;
      running = true;
      ranAt = length;
      const mine = segment;
      model
        .transcribe(joined(), { final: false, signal: abort.signal })
        .then((text) => {
          if (mine === segment && !closed && text.trim())
            on({ kind: "partial", text: text.trim() });
        })
        .catch(fail)
        .finally(() => {
          running = false;
        });
    };

    /** The segment is over: its final, in order after the ones before. */
    const cut = () => {
      if (speaking) {
        const audio = joined();
        on({ kind: "silence" });
        finals = finals.then(async () => {
          if (abort.signal.aborted) return;
          try {
            const text = (
              await model.transcribe(audio, { final: true, signal: abort.signal })
            ).trim();
            if (text && !abort.signal.aborted) on({ kind: "final", text });
          } catch (err) {
            fail(err);
          }
        });
      }
      segment++;
      chunks = [];
      length = 0;
      ranAt = 0;
      speaking = false;
      quiet = 0;
    };

    return {
      push(frame: Frame) {
        if (closed) return;
        const samples = samplesOf(frame);
        const level = levelOf(samples);
        const loud = level > Math.max(floor, noise * 3);
        if (!loud) noise = noise * 0.95 + level * 0.05;
        chunks.push(samples);
        length += samples.length;
        if (!speaking) {
          if (loud) {
            speaking = true;
            on({ kind: "speech" });
          } else {
            // Keep a little before the first word, so its start isn't clipped.
            while (length - (chunks[0]?.length ?? 0) >= preroll && chunks.length > 1) {
              length -= chunks.shift()?.length ?? 0;
            }
            return;
          }
        }
        quiet = loud ? 0 : quiet + samples.length;
        if (quiet >= pause || length >= cap) return cut();
        partial();
      },
      close() {
        closed = true;
        abort.abort();
      },
      async finish() {
        if (closed) return finals;
        closed = true;
        cut();
        await finals;
      },
    };
  }
}
