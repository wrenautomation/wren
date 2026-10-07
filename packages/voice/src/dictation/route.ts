/**
 * Which ears a dictation uses (designs/2026-10-07-dictation.md): the model in the browser when
 * it has WebGPU, else our server when it's on, else the browser's own speech if the person
 * allowed it, else none, with why. A person can pick one; a pick that can't run says why too.
 */

export const ADAPTERS = ["browser", "server", "speech"] as const;
export type Adapter = (typeof ADAPTERS)[number];

/** What a person picked on this device. */
export const CHOICES = ["auto", "browser", "server", "off"] as const;
export type Choice = (typeof CHOICES)[number];

export interface Can {
  /** A WebGPU adapter answered. */
  webgpu: boolean;
  /** `/api/dictate` says a speech server is set. */
  server: boolean;
  /** The browser has its own speech recognition. */
  speech: boolean;
  /** He allowed the browser's own speech, which sends audio to Google or Apple. Off by default. */
  fallback: boolean;
  /** Adapters that failed this visit (a model that wouldn't load). */
  failed?: readonly Adapter[];
}

export type Route = { adapter: Adapter; why: null } | { adapter: null; why: string };

const WHY: Record<Adapter, string> = {
  browser: "This browser has no WebGPU, so the speech model can't run here.",
  server: "No speech server is set up.",
  speech: "This browser has no speech recognition of its own.",
};

export function pickAdapter(choice: Choice, can: Can): Route {
  if (choice === "off") return { adapter: null, why: "Dictation is off in Your settings." };
  const failed = new Set(can.failed ?? []);
  const ok: Record<Adapter, boolean> = {
    browser: can.webgpu && !failed.has("browser"),
    server: can.server && !failed.has("server"),
    speech: can.fallback && can.speech && !failed.has("speech"),
  };
  const order: Adapter[] =
    choice === "auto"
      ? ["browser", "server", "speech"]
      : [choice, ...(can.fallback ? ["speech" as const] : [])];
  for (const a of order) if (ok[a]) return { adapter: a, why: null };
  const first = order[0] ?? "browser";
  if (failed.has(first))
    return { adapter: null, why: "The speech model didn't load. Reload to try again." };
  if (choice === "auto")
    return {
      adapter: null,
      why: can.webgpu ? WHY.server : "This browser has no WebGPU and no speech server is set up.",
    };
  return { adapter: null, why: WHY[first] };
}
