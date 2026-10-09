/**
 * Reading aloud (designs/2026-10-07-dictation.md, Reading aloud): text to speech in the portal,
 * through the voice agent's `Mouth`. The text is cleaned for the ear, cut into sentences, and each
 * sentence is spoken while the one after it is made, so the first words come after one sentence.
 * Isomorphic: the portal's page plays what this hands it.
 */
import { SentenceCutter } from "./sentences.js";
import type { Frame, Mouth } from "./types.js";

/** Markdown, links and lists as a person would say them. */
export function readable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/[`*_~#>|]+/g, " ")
    .replace(/^[ \t]*(?:[-•]|\d+[.)])[ \t]+/gm, "")
    .replace(/\s*\n+\s*/g, (m) => (m.includes("\n\n") ? ". " : ", "))
    .replace(/([.!?])[.,]\s/g, "$1 ")
    .replace(/[,.]\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.]+|[\s,]+$/g, "");
}

/** The sentences to speak, in order. A long one is cut at a comma near 300 characters. */
export function sentencesOf(text: string, max = 300): string[] {
  const cut = new SentenceCutter();
  const all = [...cut.push(`${readable(text)} `), ...[cut.flush()].filter((s) => s !== null)];
  return all.flatMap((s) => {
    const out: string[] = [];
    let rest = s;
    while (rest.length > max) {
      const at = rest.lastIndexOf(", ", max);
      const end = at > max / 3 ? at + 1 : max;
      out.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) out.push(rest);
    return out;
  });
}

/** 16-bit PCM, little endian, as a `pcm16` frame carries it. */
export function pcm16(audio: Float32Array, rate: number): Frame {
  const out = new Uint8Array(audio.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i] as number));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return { encoding: "pcm16", rate, data: out };
}

/** A `pcm16` frame back to samples for the speakers. */
export function samples(f: Frame): Float32Array {
  const view = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
  const out = new Float32Array(f.data.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Where the spoken sentences go: the page's speakers, a test's list. */
export interface Speakers {
  /** Plays one sentence's frames; resolves when they have been heard. */
  play(frames: Frame[], signal: AbortSignal): Promise<void>;
}

export interface ReadOn {
  /** Sentence `at` (from 0) of `of` begins. */
  sentence?(at: number, of: number): void;
}

/**
 * Speaks `text` through `mouth` onto `speakers`, one sentence ahead: sentence n+1 is made while
 * n plays. Stops when `signal` aborts. Resolves once the last sentence has been heard.
 */
export async function readAloud(
  mouth: Mouth,
  speakers: Speakers,
  text: string,
  signal: AbortSignal,
  on: ReadOn = {},
): Promise<void> {
  const all = sentencesOf(text);
  const make = async (s: string): Promise<Frame[]> => {
    const out: Frame[] = [];
    for await (const f of mouth.speak(s, signal)) out.push(f);
    return out;
  };
  let next = all[0] === undefined ? null : make(all[0]);
  for (let i = 0; i < all.length && next; i++) {
    const frames = await next;
    if (signal.aborted) return;
    const after = all[i + 1];
    next = after === undefined ? null : make(after);
    // A failed sentence after this one surfaces when it's awaited, not as an unhandled rejection.
    next?.catch(() => {});
    on.sentence?.(i, all.length);
    await speakers.play(frames, signal);
    if (signal.aborted) return;
  }
}
