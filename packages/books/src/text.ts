import type { MimePart } from "@wren/core/mail";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Tidy lines: trimmed, inner runs of spaces collapsed, at most one blank line between blocks. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line.replace(/(?:[ \t\u00a0\u2007\u200b\u200c\u2060]|\u200d|\u034f)+/g, " ").trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML mail as readable text: blocks become lines, table cells stay on their row. */
export function htmlText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer|blockquote)\s*>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, " \t ")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(text));
}

/**
 * The body a person reads: the plain part when it carries the message, else
 * the HTML part as text (some senders put only a stub in the plain part).
 */
export function bodyText(message: MimePart): string {
  let plain = "";
  let html = "";
  for (const part of message.walk()) {
    if (part.isAttachment()) continue;
    if (part.type === "text/plain" && !plain) plain = tidy(part.text());
    else if (part.type === "text/html" && !html) html = htmlText(part.text());
  }
  if (!html) return plain;
  return plain.length >= html.length * 0.5 ? plain : html;
}

/** A PDF's text, pages joined; null when it cannot be read (scanned, encrypted, broken). */
export async function pdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const out = tidy(text);
    return out || null;
  } catch {
    return null;
  }
}
