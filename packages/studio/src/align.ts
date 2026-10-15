/**
 * Tighter word edges (designs/2026-10-15-word-timing.md): WhisperX's wav2vec2 forced alignment
 * over whisper's own words. Same text, same count; only the times move. On three real takes it cut
 * the p90 error at pause edges from 900 to 356 ms. Align only: no diarization, no HF token.
 * Python lives in a uv venv outside the repo; a word it can't place keeps whisper's times.
 */
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Word } from "./schema.js";

export const ALIGN_DIR = join(homedir(), ".cache/wren/whisperx");
export const ALIGN_PYTHON = join(ALIGN_DIR, ".venv/bin/python");
const SETUP = `uv venv --python 3.11 ${ALIGN_DIR}/.venv && uv pip install --python ${ALIGN_PYTHON} whisperx==3.8.6`;

/** A run of words aligned as one piece of audio: words[from, to) inside [s, e]. */
export interface AlignSegment {
  from: number;
  to: number;
  s: number;
  e: number;
}
/** Per segment, per word: [start, end], or null where the aligner found no sound for it. */
export type Aligned = ([number, number] | null)[];

/** Longest piece of audio aligned at once. */
const MAX_SEGMENT_S = 15;
/** Audio either side of a segment's words, so an early start or late end can still be found. */
const PAD_S = 0.5;
const SENTENCE_END = /[.?!]["')\]]*$/;

/**
 * Words cut into sentence-sized segments (or 15 s, for a transcript with no stops), each widened
 * by half a second but never past its neighbours' words, so no two segments share audio.
 */
export function alignSegments(words: readonly Word[]): AlignSegment[] {
  const runs: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const last = i === words.length - 1;
    if (last || SENTENCE_END.test(w.w) || w.e - (words[from] as Word).s > MAX_SEGMENT_S) {
      runs.push([from, i + 1]);
      from = i + 1;
    }
  }
  return runs.map(([a, b], k) => {
    const prevEnd = k > 0 ? (words[(runs[k - 1] as [number, number])[1] - 1] as Word).e : 0;
    const next = runs[k + 1];
    const nextStart = next ? (words[next[0]] as Word).s : Number.POSITIVE_INFINITY;
    const first = words[a] as Word;
    const lastW = words[b - 1] as Word;
    return {
      from: a,
      to: b,
      s: round3(Math.max(prevEnd, first.s - PAD_S, 0)),
      e: round3(Math.min(nextStart, lastW.e + PAD_S)),
    };
  });
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const placed = (t: [number, number] | null | undefined): t is [number, number] =>
  !!t && Number.isFinite(t[0]) && Number.isFinite(t[1]) && t[1] >= t[0];

/**
 * The aligner's times over whisper's words. A segment whose count doesn't match keeps whisper's
 * times. A word the aligner couldn't place keeps whisper's, clamped between its placed neighbours,
 * so words never overlap or run backwards.
 */
export function mergeAligned(
  words: readonly Word[],
  segments: readonly AlignSegment[],
  aligned: readonly (Aligned | null)[],
): Word[] {
  const times: ([number, number] | null)[] = words.map(() => null);
  segments.forEach((seg, k) => {
    const got = aligned[k];
    if (!got || got.length !== seg.to - seg.from) return;
    got.forEach((t, j) => {
      if (placed(t)) times[seg.from + j] = t;
    });
  });
  const out: Word[] = [];
  let prevEnd = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const t = times[i];
    let s: number;
    let e: number;
    if (t) [s, e] = t;
    else {
      const next = times.slice(i + 1).find((x) => x !== null);
      const hi = Math.max(prevEnd, next ? next[0] : Number.POSITIVE_INFINITY);
      s = Math.min(Math.max(w.s, prevEnd), hi);
      e = Math.min(Math.max(w.e, s), hi);
    }
    s = round3(Math.max(s, prevEnd));
    e = round3(Math.max(e, s));
    out.push(s === w.s && e === w.e ? w : { ...w, s, e });
    prevEnd = e;
  }
  return out;
}

/**
 * Reads {wav, language, segments: [{text, start, end}], out} on stdin; writes per segment the
 * [start, end] of each of its words (null when unplaced) to `out`. One align call per segment,
 * so WhisperX's own sentence split never mixes segments. A word with no score was interpolated by
 * WhisperX, not heard: it goes back as null.
 */
const PY = `
import json, sys
import torch, whisperx
torch.set_num_threads(4)
req = json.load(sys.stdin)
audio = whisperx.load_audio(req["wav"])
dur = len(audio) / 16000
model, meta = whisperx.load_align_model(language_code=req["language"], device="cpu")
out = []
for seg in req["segments"]:
    seg = dict(seg, end=min(seg["end"], dur))
    if seg["end"] - seg["start"] < 0.05:
        out.append(None)
        continue
    res = whisperx.align([seg], model, meta, audio, "cpu", return_char_alignments=False)
    words = [w for s in res["segments"] for w in s.get("words", [])]
    out.append([[w["start"], w["end"]] if "score" in w and "start" in w and "end" in w else None for w in words])
json.dump(out, open(req["out"], "w"))
`;

/**
 * whisper's words with WhisperX's edges. Without the venv at ALIGN_DIR, whisper's times stand and
 * `warn` says how to set it up (a watched recording can't pass --no-align).
 */
export async function alignWords(
  wav: string,
  words: readonly Word[],
  opts: { language?: string; python?: string; warn?: (line: string) => void } = {},
): Promise<Word[]> {
  if (!words.length) return [...words];
  const python = opts.python ?? ALIGN_PYTHON;
  const ready = await access(python).then(
    () => true,
    () => false,
  );
  if (!ready) {
    (opts.warn ?? console.warn)(
      `no WhisperX at ${python}, keeping whisper's times. Set up: ${SETUP}`,
    );
    return [...words];
  }
  const segments = alignSegments(words);
  const out = `${wav.replace(/\.wav$/, "")}.align.json`;
  const req = {
    wav,
    language: opts.language ?? "en",
    out,
    segments: segments.map((g) => ({
      text: words
        .slice(g.from, g.to)
        .map((w) => w.w.replace(/\s+/g, ""))
        .join(" "),
      start: g.s,
      end: g.e,
    })),
  };
  await new Promise<void>((resolve, reject) => {
    const p = execFile(
      python,
      ["-I", "-c", PY],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, _stdout, stderr) =>
        err ? reject(new Error(`WhisperX align failed: ${stderr.trim().slice(-2000)}`)) : resolve(),
    );
    p.stdin?.end(JSON.stringify(req));
  });
  const aligned = JSON.parse(await readFile(out, "utf8")) as (Aligned | null)[];
  return mergeAligned(words, segments, aligned);
}
