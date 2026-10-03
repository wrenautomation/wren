/**
 * Reading structured answers out of LLM replies the way real providers answer:
 * fenced, prefaced with prose, trailed by notes that themselves contain braces.
 * Two pure layers: `firstJsonObject` finds the object, `parseModel` validates it
 * against the caller's zod shape. "Tolerant of margins, strict on shape" is one
 * behavior for every stage.
 */
import type { ZodType } from "zod";

export const NO_JSON_OBJECT = "no JSON object in response";

/** Index just past the balanced object starting at `start`, or -1 when it never closes. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Raw line breaks and tabs inside strings escaped: models write them, JSON forbids them. */
const CONTROL: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
function escapeControlsInStrings(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i] as string;
    if (inString && ch === "\\") {
      out += ch + (json[++i] ?? "");
      continue;
    }
    if (ch === '"') inString = !inString;
    out += inString ? (CONTROL[ch] ?? ch) : ch;
  }
  return out;
}

/** The object `slice` holds, strict JSON first, then with raw controls in strings escaped. */
function parseObject(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(escapeControlsInStrings(slice));
  }
}

/**
 * The first complete JSON object in `text`, or a reason string. Tolerates code
 * fences, prose before, and prose after that happens to contain a brace: the scan
 * stops at the object's own closing brace.
 */
export function firstJsonObject(text: string): Record<string, unknown> | string {
  let start = text.indexOf("{");
  while (start !== -1) {
    const end = objectEnd(text, start);
    if (end !== -1) {
      try {
        const value = parseObject(text.slice(start, end));
        if (value !== null && typeof value === "object" && !Array.isArray(value))
          return value as Record<string, unknown>;
      } catch {
        // not JSON from here; try the next brace
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return NO_JSON_OBJECT;
}

/**
 * The reply validated as `schema`, or a reason string, never an exception: a
 * malformed reply is a recorded outcome of the unit, not a crash of the run.
 */
export function parseModel<T>(text: string, schema: ZodType<T>): T | string {
  const obj = firstJsonObject(text);
  if (typeof obj === "string") return obj;
  const result = schema.safeParse(obj);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.map(String).join(".") || "$"}: ${i.message}`)
    .join("; ");
  return `ValidationError: ${issues}`;
}

/**
 * Drop lone UTF-16 surrogates. A slice through an emoji leaves half of it, and
 * Postgres refuses the half in jsonb, so the whole insert fails and its caller retries
 * forever (the pool chain stalled on one page's 👤). A provider may refuse it in a prompt.
 */
export const wellFormed = (s: string): string =>
  s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
