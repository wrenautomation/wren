/**
 * The message exactly as it goes on the wire: multipart/alternative, utf-8,
 * our Message-ID verbatim. Both parts carry the SAME words: the plain part is
 * the body pinned at compose, the HTML part is `toHtml` of that same string.
 */
import { randomBytes } from "node:crypto";
import { type OutgoingEmail, renderedSubject, toHtml } from "./transport.js";

const CRLF = "\r\n";
const ATOM_SAFE = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return true;
  return false;
}

/** RFC 2047 encoded-word when needed, else the text as is. */
export function encodeHeaderText(text: string): string {
  if (!hasNonAscii(text)) return text;
  return `=?utf-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** `Name <addr>` with the name quoted or encoded as RFC 5322/2047 require. */
export function formatAddress(name: string | null, address: string): string {
  if (!name) return address;
  if (hasNonAscii(name)) return `${encodeHeaderText(name)} <${address}>`;
  if (ATOM_SAFE.test(name)) return `${name} <${address}>`;
  return `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" <${address}>`;
}

/** RFC 5322 date, e.g. `Tue, 08 Sep 2026 13:00:00 +0000`. */
export function formatRfc5322Date(at: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${days[at.getUTCDay()]}, ${pad(at.getUTCDate())} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} +0000`
  );
}

function base64Lines(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines.join(CRLF);
}

function assertHeaderSafe(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`${name} header contains a line break`);
  return value;
}

/** The RFC 5322 bytes for an email; throws on a message with no Message-ID. */
export function buildMime(
  email: OutgoingEmail,
  opts: { now?: Date; boundary?: string } = {},
): Buffer {
  if (!email.messageId.trim()) {
    throw new Error("outgoing message has no Message-ID — the caller mints it before the send");
  }
  const boundary = opts.boundary ?? `=_wren_${randomBytes(12).toString("hex")}`;
  const headers: Array<[string, string]> = [
    ["From", formatAddress(email.fromName, email.fromAddress)],
    ["To", email.to],
    ["Subject", encodeHeaderText(renderedSubject(email))],
    ["Date", formatRfc5322Date(opts.now ?? new Date())],
    ["Message-ID", email.messageId],
  ];
  if (email.inReplyTo) headers.push(["In-Reply-To", email.inReplyTo]);
  if (email.references?.length) headers.push(["References", email.references.join(" ")]);
  headers.push(["MIME-Version", "1.0"]);
  headers.push(["Content-Type", `multipart/alternative; boundary="${boundary}"`]);
  const head = headers.map(([n, v]) => `${n}: ${assertHeaderSafe(n, v)}`).join(CRLF);
  const html = toHtml(
    email.body,
    email.signatureHtml ?? null,
    email.pixelUrl ?? null,
    email.linkCode ?? null,
  );
  const part = (type: string, content: string): string =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset="utf-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(content),
    ].join(CRLF);
  const body = [
    part("text/plain", email.body),
    part("text/html", html),
    `--${boundary}--`,
    "",
  ].join(CRLF);
  return Buffer.from(`${head}${CRLF}${CRLF}${body}`, "utf8");
}
