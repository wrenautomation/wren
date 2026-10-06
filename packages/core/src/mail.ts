/**
 * A small RFC 5322 / MIME reader — the subset of Python's stdlib `email` the
 * inbound classifier and the books' receipt reader need: unfolded and RFC 2047-decoded headers, the
 * Content-Type and its params, transfer decoding, charset decoding, multipart
 * bodies, embedded `message/rfc822` originals and the header blocks of a
 * `message/delivery-status` report. Nothing is validated: inbound mail is
 * hostile input, and a shape this cannot read degrades to "absent", never to
 * an exception in the middle of a sync.
 *
 * The bytes are carried as a latin1 string so structure (boundaries, header
 * folds) is found on text while every byte survives to be transfer- and
 * charset-decoded at the leaf. Encoded words and address lists are postal-mime's.
 */
import { addressParser, decodeWords } from "postal-mime";

export interface MimeHeader {
  readonly name: string;
  /** Unfolded (line breaks removed, continuation whitespace kept), encoded-words decoded. */
  readonly value: string;
  /** Unfolded, encoded words left as sent: what an address list must be split on. */
  readonly raw: string;
}

export interface ContentType {
  /** `type/subtype`, lowercased. */
  readonly type: string;
  readonly params: Readonly<Record<string, string>>;
}

const DEFAULT_CONTENT_TYPE: ContentType = { type: "text/plain", params: {} };

// --------------------------------------------------------------------------
// Headers

/** Past this many nested parts the rest is one leaf: hostile mail never overflows the stack. */
const MAX_DEPTH = 64;

function decodeCharset(bytes: Uint8Array, label: string | null): string {
  const name = (label ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "") || "utf-8";
  try {
    return new TextDecoder(name).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeQ(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === "=" && i + 2 < text.length && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** RFC 2047 encoded words (`=?utf-8?B?...?=`) decoded, a character split across words joined. */
export function decodeEncodedWords(value: string): string {
  if (!value.includes("=?")) return value;
  try {
    return decodeWords(value);
  } catch {
    return value;
  }
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Raw 8-bit header bytes (carried as latin1) read as UTF-8 when they are UTF-8 (RFC 6532). */
function utf8Header(value: string): string {
  if (!/[\x80-\xff]/.test(value) || /[^\x00-\xff]/.test(value)) return value;
  try {
    return UTF8.decode(latin1Bytes(value));
  } catch {
    return value;
  }
}

/** The header block of a message (or a delivery-status group) as (name, value) pairs. */
export function parseHeaders(block: string): MimeHeader[] {
  const headers: MimeHeader[] = [];
  let name: string | null = null;
  let value = "";
  const flush = () => {
    if (name !== null) {
      const raw = utf8Header(value);
      headers.push({ name, value: decodeEncodedWords(raw), raw });
    }
    name = null;
    value = "";
  };
  for (const line of block.split(/\r?\n/)) {
    if (line === "") continue;
    if ((line.startsWith(" ") || line.startsWith("\t")) && name !== null) {
      value += line; // unfold: the break goes, the whitespace stays
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) break; // not a header: Python stops the header section here too
    flush();
    name = line.slice(0, colon).trim();
    value = line.slice(colon + 1).replace(/^[ \t]/, "");
  }
  flush();
  return headers;
}

/** `type/subtype; a=b; c="d e"` read leniently; the type is lowercased, param names too. */
export function parseContentType(value: string | null): ContentType | null {
  if (!value) return null;
  const [head, ...rest] = value.split(";");
  const type = (head ?? "").trim().toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) return null;
  // Params may carry ";" inside quotes; re-join and scan instead of trusting the split.
  return { type, params: parseParams(rest.join(";")) };
}

/**
 * `a=b; c="d e"` after a header's first token; names lowercased, the first of a name wins.
 * RFC 2231 continuations (`filename*0*=UTF-8''a; filename*1*=b`) are joined and decoded
 * under the bare name.
 */
function parseParams(tail: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pieces = new Map<string, Array<{ n: number; value: string; extended: boolean }>>();
  const param = /\s*([^=;\s]+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]*)\s*(?:;|$)/g;
  for (const m of tail.matchAll(param)) {
    const key = (m[1] ?? "").toLowerCase();
    const quoted = m[3];
    const raw = quoted !== undefined ? quoted.replace(/\\(.)/g, "$1") : (m[2] ?? "").trim();
    const piece = /^(.+)\*(\d+)(\*?)$/.exec(key);
    if (piece) {
      const list = pieces.get(piece[1] as string) ?? [];
      list.push({ n: Number(piece[2]), value: raw, extended: piece[3] === "*" });
      pieces.set(piece[1] as string, list);
    } else if (key && !(key in params)) params[key] = raw;
  }
  for (const [name, list] of pieces) {
    if (name in params || `${name}*` in params) continue;
    list.sort((a, b) => a.n - b.n);
    const first = list[0];
    const charset = first?.extended ? /^([\w-]*)'[\w-]*'/.exec(first.value) : null;
    const bytes: number[] = [];
    for (const [i, { value, extended }] of list.entries()) {
      const text = i === 0 && charset ? value.slice(charset[0].length) : value;
      pushBytes(bytes, text, extended);
    }
    params[name] = decodeCharset(Uint8Array.from(bytes), charset?.[1] || "utf-8");
  }
  return params;
}

/** `text` as bytes; `%XX` escapes decoded when it is an RFC 2231 extended value. */
function pushBytes(out: number[], text: string, extended: boolean): void {
  for (let i = 0; i < text.length; i++) {
    const hex = text.slice(i + 1, i + 3);
    if (extended && text[i] === "%" && /^[0-9a-f]{2}$/i.test(hex)) {
      out.push(Number.parseInt(hex, 16));
      i += 2;
    } else out.push(text.charCodeAt(i) & 0xff);
  }
}

/** An RFC 2231 extended value (`UTF-8''Invoice%20123.pdf`) decoded; a plain value unchanged. */
function decodeExtended(value: string): string {
  const m = /^([\w-]*)'[\w-]*'(.*)$/.exec(value);
  if (!m) return value;
  const bytes: number[] = [];
  pushBytes(bytes, m[2] ?? "", true);
  return decodeCharset(Uint8Array.from(bytes), m[1] || "utf-8");
}

// --------------------------------------------------------------------------
// Bodies

function decodeQuotedPrintable(text: string): Uint8Array {
  // Soft breaks join lines; trailing whitespace before a hard break is transport noise.
  const joined = text.replace(/=\r?\n/g, "").replace(/[ \t]+(\r?\n)/g, "$1");
  return decodeQ(joined);
}

function latin1Bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "latin1"));
}

function splitHeadBody(raw: string): [string, string] {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  let at = -1;
  let width = 0;
  if (crlf >= 0 && (lf < 0 || crlf < lf)) [at, width] = [crlf, 4];
  else if (lf >= 0) [at, width] = [lf, 2];
  if (at < 0) return [raw, ""];
  return [raw.slice(0, at), raw.slice(at + width)];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The bodies between the delimiter lines of a multipart body; preamble and epilogue dropped. */
function splitMultipart(body: string, boundary: string): string[] {
  const b = escapeRegExp(boundary);
  const delimiter = new RegExp(`(?:^|\\r?\\n)--${b}(--)?[ \\t]*(?:\\r?\\n|$)`, "g");
  const parts: string[] = [];
  let open: number | null = null;
  for (const m of body.matchAll(delimiter)) {
    if (open !== null) parts.push(body.slice(open, m.index));
    if (m[1] !== undefined) return parts; // the close delimiter
    open = m.index + m[0].length;
  }
  if (open !== null) parts.push(body.slice(open)); // no close delimiter: take what is there
  return parts;
}

/** Header groups of a `message/delivery-status` body, one per blank-line-separated block. */
function splitBlocks(body: string): string[] {
  return body
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export class MimePart {
  constructor(
    readonly headers: readonly MimeHeader[],
    private readonly rawBody: string,
    readonly parts: readonly MimePart[],
  ) {}

  /** The first header of this name, unfolded; `null` when absent. Names compare case-insensitively. */
  get(name: string): string | null {
    const wanted = name.toLowerCase();
    return this.headers.find((h) => h.name.toLowerCase() === wanted)?.value ?? null;
  }

  getAll(name: string): string[] {
    const wanted = name.toLowerCase();
    return this.headers.filter((h) => h.name.toLowerCase() === wanted).map((h) => h.value);
  }

  /** The first header of this name with its encoded words as sent: feed address headers from here. */
  getRaw(name: string): string | null {
    const wanted = name.toLowerCase();
    return this.headers.find((h) => h.name.toLowerCase() === wanted)?.raw ?? null;
  }

  getAllRaw(name: string): string[] {
    const wanted = name.toLowerCase();
    return this.headers.filter((h) => h.name.toLowerCase() === wanted).map((h) => h.raw);
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }

  get contentType(): ContentType {
    return parseContentType(this.get("Content-Type")) ?? DEFAULT_CONTENT_TYPE;
  }

  /** `text/plain` when no Content-Type says otherwise, as the stdlib defaults it. */
  get type(): string {
    return this.contentType.type;
  }

  get maintype(): string {
    return this.type.split("/", 1)[0] ?? "text";
  }

  /** A Content-Type parameter (`boundary`, `charset`, `report-type`), or null. */
  param(name: string): string | null {
    return this.contentType.params[name.toLowerCase()] ?? null;
  }

  isAttachment(): boolean {
    const disposition = this.get("Content-Disposition");
    return (
      disposition !== null && disposition.split(";", 1)[0]?.trim().toLowerCase() === "attachment"
    );
  }

  /**
   * The attachment's file name: Content-Disposition `filename` (RFC 2231 `filename*` too),
   * else Content-Type `name`; null when neither names it.
   */
  filename(): string | null {
    const disposition = this.get("Content-Disposition");
    const params = disposition ? parseParams(disposition.split(";").slice(1).join(";")) : {};
    const extended = params["filename*"];
    if (extended) return decodeExtended(extended);
    return params.filename ?? this.param("name");
  }

  /** This part, then every descendant, depth first — the stdlib's `walk()`. */
  *walk(): IterableIterator<MimePart> {
    yield this;
    for (const part of this.parts) yield* part.walk();
  }

  /** The body after transfer decoding (identity for 7bit/8bit/binary). */
  bytes(): Uint8Array {
    const encoding = (this.get("Content-Transfer-Encoding") ?? "").trim().toLowerCase();
    if (encoding === "base64") {
      try {
        return Uint8Array.from(Buffer.from(this.rawBody, "base64"));
      } catch {
        return latin1Bytes(this.rawBody);
      }
    }
    if (encoding === "quoted-printable") return decodeQuotedPrintable(this.rawBody);
    return latin1Bytes(this.rawBody);
  }

  /** The body as text in its declared charset (utf-8 when none), undecodable bytes replaced. */
  text(): string {
    return decodeCharset(this.bytes(), this.param("charset"));
  }
}

function buildPart(raw: string, depth = 0): MimePart {
  const [head, body] = splitHeadBody(raw);
  const headers = parseHeaders(head);
  const scratch = new MimePart(headers, body, []);
  if (depth >= MAX_DEPTH) return scratch;
  const type = scratch.type;
  if (scratch.maintype === "multipart") {
    const boundary = scratch.param("boundary");
    if (!boundary) return scratch; // unreadable multipart: a leaf with the raw body, like the stdlib's defect
    return new MimePart(
      headers,
      body,
      splitMultipart(body, boundary).map((piece) => buildPart(piece, depth + 1)),
    );
  }
  if (type === "message/rfc822") return new MimePart(headers, body, [buildPart(body, depth + 1)]);
  if (type === "message/delivery-status" || type === "message/disposition-notification") {
    return new MimePart(
      headers,
      body,
      splitBlocks(body).map((block) => new MimePart(parseHeaders(block), "", [])),
    );
  }
  return scratch;
}

/** Parse one raw RFC 5322 message. Never throws on shape: unreadable structure becomes a leaf. */
export function parseMessage(raw: Uint8Array | string): MimePart {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("latin1");
  return buildPart(text);
}

// --------------------------------------------------------------------------
// Addresses

function stripComments(text: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"' && depth === 0) {
      quoted = true;
      out += ch;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Every mailbox in a list, group members flattened; a bare token reads as the address, as the stdlib has it. */
function mailboxes(value: string): Array<[string, string]> {
  let parsed: ReturnType<typeof addressParser>;
  try {
    parsed = addressParser(value.replace(/\r?\n/g, " "));
  } catch {
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const entry of parsed.flatMap((a) => ("group" in a && a.group ? a.group : [a]))) {
    const name = (entry.name ?? "").trim();
    const address = ("address" in entry ? (entry.address ?? "") : "").trim();
    if (address) out.push([name, address]);
    else if (name && !/\s/.test(name)) out.push(["", name]);
  }
  return out;
}

/**
 * One mailbox as (display name, addr-spec) — `parseaddr`. Pass the raw header
 * (encoded words as sent); malformed input yields empty strings.
 */
export function parseAddr(value: string): [string, string] {
  return mailboxes(value)[0] ?? ["", ""];
}

/** Every mailbox in the given raw header values — `getaddresses`. Group syntax is read as its members. */
export function getAddresses(values: readonly string[]): Array<[string, string]> {
  return values.flatMap(mailboxes);
}

// --------------------------------------------------------------------------
// Dates

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
// RFC 5322 §4.3 obsolete zone names, as the stdlib maps them; anything unknown is UTC.
const ZONES: Readonly<Record<string, number>> = {
  ut: 0,
  utc: 0,
  gmt: 0,
  z: 0,
  est: -5,
  edt: -4,
  cst: -6,
  cdt: -5,
  mst: -7,
  mdt: -6,
  pst: -8,
  pdt: -7,
};
const DATE =
  /^\s*(?:[A-Za-z]{3,},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([+-])(\d{2})(\d{2})|([A-Za-z]{1,4}))?/;

/** An RFC 5322 date as an instant — `parsedate_to_datetime`; unreadable dates are `null`. */
export function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const m = DATE.exec(stripComments(value));
  if (!m) return null;
  const month = MONTHS[(m[2] as string).toLowerCase()];
  if (month === undefined) return null;
  let year = Number(m[3]);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  const [day, hour, minute, second] = [Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  let offsetMinutes = 0;
  if (m[7]) {
    offsetMinutes = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  } else if (m[10]) {
    offsetMinutes = (ZONES[m[10].toLowerCase()] ?? 0) * 60;
  }
  const wall = Date.UTC(year, month, day, hour, minute, second);
  // A day or time out of range rolls over in Date.UTC; the stdlib refuses it.
  if (new Date(wall).getUTCDate() !== day || hour > 23 || minute > 59 || second > 60) return null;
  return new Date(wall - offsetMinutes * 60_000);
}
