/**
 * The self-check (designs/2026-10-24-video-film-file.md, Decision 2): a rendered file against the
 * bar (`bar.ts`), before he Approves. ffmpeg makes a contact sheet (one frame every 2 s or more,
 * in time order) and 3 full frames, and finds the scene cuts; one Gemini ask reads them with
 * the captions' words. Gemini, not Cohere: Cohere's vision refuses frames with a person.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askGemini, runFor, sceneCuts, TOOL_MS } from "@wren/video-watch";
import { z } from "zod";
import { BAR_IDS, type BarFormat, barLines, VIDEO_CHECK } from "./bar.js";

export { VIDEO_CHECK };
/** Frames on one sheet: more and each tile is too small to read. */
export const SHEET_MAX = 48;
const SHEET_EVERY_S = 2;

export interface CheckIssue {
  /** Seconds into the rendered file. */
  at: number;
  rule: string;
  says: string;
}
export interface CheckResult {
  pass: boolean;
  issues: CheckIssue[];
}

const ANSWER = z.object({
  pass: z.boolean(),
  issues: z
    .array(
      z.object({
        at: z.number().min(0),
        rule: z.string(),
        says: z.string().trim().min(1).max(400),
      }),
    )
    .max(20),
});

/** The model's JSON as a result; a rule not on the bar reads as `best`, an issue means no pass. */
export function parseCheck(text: string): CheckResult {
  const raw = text
    .trim()
    .replace(/^```(json)?|```$/g, "")
    .trim();
  const a = ANSWER.parse(JSON.parse(raw));
  const issues = a.issues.map((i) => ({
    at: Math.round(i.at * 10) / 10,
    rule: BAR_IDS.includes(i.rule) ? i.rule : "best",
    says: i.says,
  }));
  return { pass: a.pass && !issues.length, issues };
}

/** Where the sheet's tiles sit: `every` seconds apart, `cols` across, `n` in all. */
export function sheetGrid(durationS: number) {
  const every = Math.max(SHEET_EVERY_S, Math.ceil(durationS / SHEET_MAX));
  const n = Math.max(1, Math.min(SHEET_MAX, Math.ceil(durationS / every)));
  const cols = Math.min(8, n);
  return { every, n, cols, rows: Math.ceil(n / cols) };
}

export function checkPrompt(
  format: BarFormat,
  o: { durationS: number; every: number; cols: number; cuts: number[]; words: string },
): string {
  return [
    `You check one rendered ${format === "short" ? "Short (9:16, 60 s or less)" : "video"} before it is posted. It is ${o.durationS.toFixed(1)} s long.`,
    `Image 1 is a contact sheet: one frame every ${o.every} s, left to right then down, ${o.cols} across, so tile k (from 0) is at k × ${o.every} s. Images 2 to 4 are full frames at the start, the middle and the end.`,
    `Scene cuts ffmpeg found (s): ${o.cuts.length ? o.cuts.join(", ") : "none"}.`,
    `What is said, with times (s):\n${o.words || "(no words)"}`,
    `The bar:\n${barLines(format)}`,
    `Answer with one JSON object and nothing else: {"pass": true or false, "issues": [{"at": seconds, "rule": one of ${BAR_IDS.join(", ")}, "says": "what is wrong, one plain sentence"}]}.`,
    "List only real breaks of the bar you can see or read. Do not guess at what a frame you cannot read shows. pass is true only when issues is empty.",
  ].join("\n\n");
}

/** One frame per tile, in time order, tiled into one jpg; plus 3 full frames. */
async function sheet(file: string, dir: string, durationS: number, ffmpeg: string) {
  const g = sheetGrid(durationS);
  const out = join(dir, "sheet.jpg");
  await runFor(
    ffmpeg,
    [
      ...["-hide_banner", "-loglevel", "error", "-i", file, "-an"],
      ...["-vf", `fps=1/${g.every},scale=360:-2,tile=${g.cols}x${g.rows}`],
      ...["-frames:v", "1", "-q:v", "4", "-y", out],
    ],
    TOOL_MS,
  );
  const times = [0.5, durationS / 2, Math.max(0, durationS - 0.5)];
  const stills = await Promise.all(
    times.map(async (t, i) => {
      const f = join(dir, `still-${i}.jpg`);
      await runFor(
        ffmpeg,
        [
          ...["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", file],
          ...["-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", "-q:v", "3", "-y", f],
        ],
        TOOL_MS,
      );
      return readFile(f);
    }),
  );
  return { grid: g, images: [await readFile(out), ...stills] };
}

/**
 * Check one rendered file. `words`: what is said in it, on its own clock (the captions' words).
 * Throws when every Gemini key refused, so the run shows failed, never a pass.
 */
export async function checkRender(
  file: string,
  o: {
    format: BarFormat;
    durationS: number;
    words: readonly { w: string; s: number }[];
    geminiKeys: readonly string[];
    ffmpeg: string;
    fetchFn?: typeof fetch;
  },
): Promise<CheckResult> {
  if (!o.geminiKeys.length) throw new Error("no GEMINI keys in llm.env");
  const dir = await mkdtemp(join(tmpdir(), "video-check-"));
  try {
    const [{ grid, images }, cuts] = await Promise.all([
      sheet(file, dir, o.durationS, o.ffmpeg),
      sceneCuts(file, o.ffmpeg),
    ]);
    const words = o.words.map((w) => `${w.s.toFixed(1)} ${w.w}`).join("\n");
    const prompt = checkPrompt(o.format, { durationS: o.durationS, ...grid, cuts, words });
    const r = await askGemini(
      {
        contents: [
          {
            parts: [
              ...images.map((b) => ({
                inlineData: { mimeType: "image/jpeg", data: b.toString("base64") },
              })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      },
      o.geminiKeys,
      o.fetchFn ?? fetch,
      VIDEO_CHECK,
    );
    if ("unread" in r) throw new Error(`gemini check: unread, last ${r.unread}`);
    return parseCheck(r.text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
