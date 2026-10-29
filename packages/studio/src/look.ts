/**
 * Looking at the picture (designs/2026-10-06-video-editor.md): a model watches the cut file and
 * writes moments, Shorts ideas, chapters and thumbnail frames onto the edit. Nothing applies them;
 * Claude Code reads them like the transcript. Gemini reads a 360p copy through the Files API
 * (`geminiFile`) with the SOP reader's model order. Cohere reads no video: the SOP reader's `watch`
 * hands it the scene cuts and a vision model's line per frame, and a text model answers from those
 * and the transcript. TwelveLabs indexes the same copy once in
 * `wren-videos` (Marengo, for `wren video find`) and asks Pegasus; its free plan is 600 minutes
 * across indexing and analysis, so it stops before a call that would pass them.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { cohere, geminiFile } from "@wrenautomation/models";
import {
  COHERE_TEXT_MODEL,
  clock,
  cohereEye,
  cutsLine,
  geminiReader,
  onScreenLines,
  watch,
} from "@wrenautomation/read/video";
import { z } from "zod";
import { fromCutTime, type Span, toCutTime } from "./cuts.js";
import type { Look, Word } from "./schema.js";

export const LOOK_PROVIDERS = ["gemini", "twelvelabs", "cohere"] as const;
export type LookProvider = (typeof LOOK_PROVIDERS)[number];

/**
 * One look: the cut file (360p), its transcript on the cut timeline, and the provider's copy from
 * the last look (reused while the cut is the same) in; a Look out.
 */
export type Looker = (
  file: string,
  transcript: string,
  prior?: Look["media"],
) => Promise<Omit<Look, "at">>;

const SHAPE = `{"summary": one line on what the video is,
 "moments": [{"at": s, "why": what happens on screen that matters}] (screen changes, demos, strong lines; up to 15),
 "shorts": [{"from": s, "to": s, "title": short title}] (8 to 12 clips of 20 to 60 s, each opening on a hook in its first 2 seconds, making one point that makes sense alone, ending clean; they work visually),
 "chapters": [{"at": s, "title": 2 to 5 words}] (first at 0, at screen or topic changes),
 "thumbnails": [{"at": s, "why": why this frame}] (3 frames: face clear, expressive, screen readable)}`;

const ASK = (transcript: string) =>
  `You are helping edit this YouTube video. Watch it and answer in JSON only, with times in seconds of this file:
${SHAPE}
The transcript, for exact words:
${transcript}`;

/** The same ask for a model that cannot play the video: it gets what `watch` found instead. */
const ASK_SEEN = (transcript: string, seen: string) =>
  `You are helping edit this YouTube video. You cannot play it. You have the scene cuts ffmpeg found, and what a vision model read off one frame in every few seconds, each line under its frame time ("not read" means that frame is unknown: do not guess it; faces and expressions are not described). Answer in JSON only, with times in seconds of this file:
${SHAPE}
The transcript, for exact words:
${transcript}
${seen}`;

const sec = z.coerce.number().min(0);
const lookSchema = z.object({
  summary: z.string().default(""),
  moments: z.array(z.object({ at: sec, why: z.string() })).default([]),
  shorts: z.array(z.object({ from: sec, to: sec, title: z.string() })).default([]),
  chapters: z.array(z.object({ at: sec, title: z.string() })).default([]),
  thumbnails: z.array(z.object({ at: sec, why: z.string() })).default([]),
});

/** A model's answer as a look; some wrap the object in a one-item list. */
const lookAnswer = z.preprocess((v) => (Array.isArray(v) ? v[0] : v), lookSchema);

export function geminiLooker(keys: readonly string[], fetchFn: typeof fetch = fetch): Looker {
  if (!keys.length) throw new Error("no GEMINI keys in llm.env");
  return async (file, transcript) => {
    // The file lives in one key's project, so the read uses that key alone.
    const up = await geminiFile(await readFile(file), {
      key: keys,
      mediaType: "video/mp4",
      displayName: basename(file),
      fetch: fetchFn,
    });
    try {
      const a = await geminiReader([up.key], { fetch: fetchFn }).ask(
        [up.part, { type: "text", text: ASK(transcript) }],
        lookAnswer,
        { resolution: "low", purpose: "video look" },
      );
      return a.value;
    } finally {
      await up.drop();
    }
  };
}

/**
 * Cohere on the cut file (360p): `watch` for the cuts and the on-screen text (the transcript is
 * the edit's own, so it skips the speech), then one text ask for the same JSON as the other
 * providers. Times are cut-file seconds.
 */
export function cohereLooker(
  keys: readonly string[],
  o: { ffmpeg?: string; fetchFn?: typeof fetch } = {},
): Looker {
  if (!keys.length) throw new Error("no COHERE keys");
  const wire = o.fetchFn ? { fetch: o.fetchFn } : {};
  return async (file, transcript) => {
    const seen = await watch(file, {
      eye: cohereEye(keys, wire),
      speech: false,
      ...(o.ffmpeg ? { ffmpeg: o.ffmpeg } : {}),
    });
    const prompt = ASK_SEEN(
      transcript,
      `Scene cuts: ${cutsLine(seen)}\nOn screen:\n${onScreenLines(seen).join("\n") || "(no text read)"}`,
    );
    const a = await cohere({ key: keys, model: COHERE_TEXT_MODEL, ...wire }).ask(
      prompt,
      lookAnswer,
      { maxTokens: 4096, purpose: "look" },
    );
    return a.value;
  };
}

const TL = "https://api.twelvelabs.io/v1.3";
const TL_INDEX = "wren-videos";
/** The free plan: minutes shared by indexing and analysis. */
export const TL_FREE_MINUTES = 600;

/** The same ask as Gemini's, as the JSON schema Pegasus answers in. */
const TL_SCHEMA = (() => {
  const at = { type: "number" };
  const obj = (props: Record<string, unknown>) => ({
    type: "object",
    properties: props,
    required: Object.keys(props),
  });
  const list = (props: Record<string, unknown>) => ({ type: "array", items: obj(props) });
  return obj({
    summary: { type: "string" },
    moments: list({ at, why: { type: "string" } }),
    shorts: list({ from: at, to: at, title: { type: "string" } }),
    chapters: list({ at, title: { type: "string" } }),
    thumbnails: list({ at, why: { type: "string" } }),
  });
})();

/** A TwelveLabs call; the key goes in a header and never into an error. */
function twelvelabsApi(key: string, fetchFn: typeof fetch = fetch) {
  return async <T>(method: string, path: string, body?: object | FormData): Promise<T> => {
    const form = body instanceof FormData;
    const res = await fetchFn(`${TL}${path}`, {
      method,
      headers: {
        "x-api-key": key,
        ...(body && !form ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`twelvelabs ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };
}
type TlApi = ReturnType<typeof twelvelabsApi>;

/** `wren-videos`, made on first use (Marengo, visual + audio: what `find` searches). */
async function tlIndex(api: TlApi): Promise<string> {
  const { data } = await api<{ data: { _id: string; index_name: string }[] }>(
    "GET",
    `/indexes?index_name=${TL_INDEX}`,
  );
  const found = data.find((i) => i.index_name === TL_INDEX);
  if (found) return found._id;
  const made = await api<{ _id: string }>("POST", "/indexes", {
    index_name: TL_INDEX,
    models: [{ model_name: "marengo3.0", model_options: ["visual", "audio"] }],
  });
  return made._id;
}

async function until(get: () => Promise<{ status?: string }>, what: string): Promise<void> {
  for (let i = 0; i < 360; i++) {
    const r = await get();
    if (r.status === "ready") return;
    if (r.status === "failed")
      throw new Error(`twelvelabs ${what}: failed ${JSON.stringify(r).slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  throw new Error(`twelvelabs ${what}: not ready after 30 min`);
}

/**
 * Pegasus on the cut file. `usedMinutes` is what every edit has spent so far; a look that would
 * pass `TL_FREE_MINUTES` stops before any upload. `cut` names this cut file's version, so the
 * same cut is indexed once.
 */
export function twelvelabsLooker(
  key: string | undefined,
  o: { usedMinutes: number; durationS: number; cut: string; fetchFn?: typeof fetch },
): Looker {
  if (!key) throw new Error("TWELVELABS_API_KEY not set");
  const api = twelvelabsApi(key, o.fetchFn);
  return async (file, transcript, prior) => {
    const reuse = prior?.cut === o.cut ? prior : undefined;
    // Indexing and analysis each count the video's minutes.
    const minutes = Math.ceil(o.durationS / 60) * (reuse ? 1 : 2);
    if (o.usedMinutes + minutes > TL_FREE_MINUTES)
      throw new Error(
        `twelvelabs: this look needs ${minutes} min and ${o.usedMinutes} of the free ${TL_FREE_MINUTES} are used; past it is William's call`,
      );
    let media = reuse;
    if (!media) {
      const index = await tlIndex(api);
      const form = new FormData();
      form.set("method", "direct");
      form.set("file", new Blob([await readFile(file)], { type: "video/mp4" }), basename(file));
      const { _id: asset } = await api<{ _id: string }>("POST", "/assets", form);
      await until(() => api("GET", `/assets/${asset}`), `asset ${asset}`);
      const { _id: id } = await api<{ _id: string }>("POST", `/indexes/${index}/indexed-assets`, {
        asset_id: asset,
      });
      await until(() => api("GET", `/indexes/${index}/indexed-assets/${id}`), `indexing ${id}`);
      media = { id, asset, cut: o.cut, minutes: prior?.minutes ?? 0 };
    }
    const r = await api<{ data?: string; finish_reason?: string }>("POST", "/analyze", {
      model_name: "pegasus1.6",
      video: { type: "asset_id", asset_id: media.asset },
      prompt: ASK(transcript),
      stream: false,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: "json_schema", json_schema: TL_SCHEMA },
    });
    if (r.finish_reason !== "stop" || !r.data)
      throw new Error(`twelvelabs analyze: ${r.finish_reason ?? "no answer"}`);
    return {
      ...lookAnswer.parse(JSON.parse(r.data)),
      media: { ...media, minutes: media.minutes + minutes },
    };
  };
}

/** Moments in the indexed cut file that match the words, in cut-file seconds, best first. */
export async function twelvelabsFind(
  key: string | undefined,
  media: NonNullable<Look["media"]>,
  words: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ start: number; end: number; rank?: number }[]> {
  if (!key) throw new Error("TWELVELABS_API_KEY not set");
  const api = twelvelabsApi(key, fetchFn);
  const form = new FormData();
  form.set("index_id", await tlIndex(api));
  form.set("query_text", words);
  form.append("search_options", "visual");
  form.append("search_options", "audio");
  form.set("filter", JSON.stringify({ id: [media.id] }));
  form.set("page_limit", "10");
  const r = await api<{ data?: { start: number; end: number; rank?: number }[] }>(
    "POST",
    "/search",
    form,
  );
  return r.data ?? [];
}

/** The cut file's words on its own timeline, a [m:ss] mark each line. */
export function cutTranscript(words: readonly Word[], keep: readonly Span[]): string {
  const lines: string[] = [];
  let line: string[] = [];
  let lineAt = -1;
  for (const w of words) {
    const t = toCutTime(w.s, keep);
    if (t === null) continue;
    if (lineAt < 0) lineAt = t;
    line.push(w.w);
    if (line.length >= 14 || /[.?!]$/.test(w.w)) {
      lines.push(`[${clock(lineAt)}] ${line.join(" ")}`);
      line = [];
      lineAt = -1;
    }
  }
  if (line.length) lines.push(`[${clock(lineAt)}] ${line.join(" ")}`);
  return lines.join("\n");
}

/** A look's cut-file times moved back onto the raw timeline, like every other time in the edit. */
export function toRaw(look: Omit<Look, "at">, keep: readonly Span[]): Look {
  const r = (t: number) => Math.round(fromCutTime(t, keep) * 100) / 100;
  return {
    at: new Date().toISOString(),
    summary: look.summary,
    ...(look.media ? { media: look.media } : {}),
    moments: look.moments.map((m) => ({ ...m, at: r(m.at) })),
    shorts: look.shorts.map((s) => ({ ...s, from: r(s.from), to: r(s.to) })),
    chapters: look.chapters.map((c) => ({ ...c, at: r(c.at) })),
    thumbnails: look.thumbnails.map((t) => ({ ...t, at: r(t.at) })),
  };
}
