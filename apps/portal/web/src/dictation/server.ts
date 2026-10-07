/**
 * The server adapter's `Transcriber`: each segment as a WAV to the portal Worker's `/api/dictate`
 * (apps/portal/src/dictate.ts), which asks our speech server.
 */
import { type Transcriber, wavOf } from "@wren/voice/dictation";
import { authHeaders } from "../api.js";

/** Whether the Worker has a speech server, and its model. */
export async function serverDictation(): Promise<{ on: boolean; model: string | null }> {
  try {
    const res = await fetch("/api/dictate", { headers: await authHeaders() });
    const body = (await res.json()) as { on?: unknown; model?: unknown };
    return {
      on: res.ok && body.on === true,
      model: typeof body.model === "string" ? body.model : null,
    };
  } catch {
    return { on: false, model: null };
  }
}

export class ServerModel implements Transcriber {
  readonly name = "server";
  constructor(readonly model: string) {}

  async transcribe(audio: Float32Array, o: { signal?: AbortSignal }): Promise<string> {
    const res = await fetch("/api/dictate", {
      method: "POST",
      headers: { "content-type": "audio/wav", ...(await authHeaders()) },
      body: wavOf(audio) as Uint8Array<ArrayBuffer>,
      ...(o.signal ? { signal: o.signal } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `${res.status}`);
    return typeof body.text === "string" ? body.text : "";
  }
}
