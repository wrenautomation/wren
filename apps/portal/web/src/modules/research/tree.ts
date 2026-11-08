/** Small reads the back and forth shares: a url's host, a page's tone, kept findings per page. */
import type { GraphTone } from "@wren/ui";
import type { RunDocument, RunView } from "./serve.js";

export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

type Tone = Exclude<GraphTone, "accent">;
const QUALITY: Record<string, Tone> = { rich: "good", thin: "warn", off: "bad", empty: "bad" };

/** A page's tone: its verdict, else whether a kept finding sits on it. */
export function toneOf(d: RunDocument, kept: number): Tone {
  if (d.verdict) return QUALITY[d.verdict.quality] ?? "neutral";
  return kept ? "good" : "neutral";
}

export function keptBy(view: RunView): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of view.findings) if (f.kept) out.set(f.document, (out.get(f.document) ?? 0) + 1);
  return out;
}
