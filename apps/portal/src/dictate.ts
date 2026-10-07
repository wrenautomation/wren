/**
 * Dictation's server adapter (designs/2026-10-07-dictation.md): `/api/dictate`.
 *
 * - GET: `{on, model}`, whether a speech server is set up (`DICTATE_URL`). The demo is always off.
 * - POST: one segment as a 16 kHz mono WAV, from a signed-in person; answers `{text}`. The audio
 *   goes to an OpenAI-compatible `/audio/transcriptions` (Groq, faster-whisper, our GPU later)
 *   and is kept nowhere.
 */
import { openAiTranscriber, samplesOfWav, type Transcriber } from "@wren/voice/dictation";

/** About 60 s of 16 kHz 16-bit audio: past the 20 s a segment is cut at. */
export const MAX_WAV = 2 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function readBytes(req: Request, max: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

/** The settings this reads: a slice of the Worker's `Env`, so the Node preview can use it too. */
export type DictateEnv = { DICTATE_URL?: string; DICTATE_MODEL?: string; DICTATE_KEY?: string };

export function serverTranscriber(env: DictateEnv, f?: typeof fetch): Transcriber | null {
  if (!env.DICTATE_URL) return null;
  return openAiTranscriber({
    url: env.DICTATE_URL,
    model: env.DICTATE_MODEL ?? "whisper-large-v3-turbo",
    key: env.DICTATE_KEY,
    ...(f ? { fetch: f } : {}),
  });
}

export async function dictate(
  req: Request,
  env: DictateEnv,
  o: { demo: boolean; signedIn: () => Promise<Response | null> },
): Promise<Response> {
  const model = o.demo ? null : serverTranscriber(env);
  if (req.method === "GET") return json(model ? { on: true, model: model.model } : { on: false });
  if (req.method !== "POST") return json({ error: "GET or POST only" }, 405);
  if (o.demo) return json({ error: "The demo doesn't take dictation." }, 403);
  // Not a form type, so another site's page can't post here without a preflight.
  if (req.headers.get("content-type") !== "audio/wav")
    return json({ error: "audio/wav only" }, 415);
  const refused = await o.signedIn();
  if (refused) return refused;
  if (!model) return json({ error: "No speech server is set up." }, 503);
  const bytes = await readBytes(req, MAX_WAV);
  if (!bytes) return json({ error: "too large" }, 413);
  const audio = samplesOfWav(bytes);
  if (!audio) return json({ error: "Send 16 kHz mono 16-bit WAV." }, 400);
  try {
    return json({ text: await model.transcribe(audio, { final: true }) });
  } catch {
    return json({ error: "The speech server didn't answer." }, 502);
  }
}
