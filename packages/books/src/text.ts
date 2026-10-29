import type { MimePart } from "@wren/core/mail";
import { htmlText, tidy } from "@wrenautomation/read/text";

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
