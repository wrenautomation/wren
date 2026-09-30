/** Fixture mail and an in-memory Gmail read side, shared by the inbox and scheduler suites. */
import { readFileSync } from "node:fs";
import { parseMessage } from "@wren/core/mail";
import { type InboxReader, METADATA_HEADERS, type MessageMetadata } from "../../src/inbox/sync.js";

export const FIXTURES = new URL("../fixtures/inbound/", import.meta.url);

export const OTHER_SENDER = "william@wren-automation.test";
/** What the fixtures call our outgoing message; every loader rewrites it. */
export const FIXTURE_OUR_ID = "<abc@wren-automation.com>";
export const OUR_ID = "<opener@wren-automation.test>";
export const THREAD = "t1";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = new Date(Date.UTC(2026, 8, 8, 12, 0));
export const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

// --------------------------------------------------------------------------
// Fixture mail

/** Remove whole header fields (continuation lines included): how a client that threads by nothing but the provider's own conversation id is simulated. */
function dropHeaders(text: string, names: readonly string[]): string {
  const lowered = new Set(names.map((n) => n.toLowerCase()));
  const at = text.indexOf("\n\n");
  const head = at === -1 ? text : text.slice(0, at);
  const rest = at === -1 ? "" : text.slice(at);
  const kept: string[] = [];
  let dropping = false;
  for (const line of head.split("\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (dropping) continue;
    } else {
      dropping = lowered.has((line.split(":", 1)[0] ?? "").trim().toLowerCase());
    }
    if (!dropping) kept.push(line);
  }
  return kept.join("\n") + rest;
}

/** One fixture, re-pointed at the enrollment under test. */
export function load(
  name: string,
  opts: { ourId?: string; drop?: readonly string[] } = {},
): Uint8Array {
  let text = readFileSync(new URL(`${name}.eml`, FIXTURES), "utf8");
  text = text.replaceAll(FIXTURE_OUR_ID, opts.ourId ?? OUR_ID);
  if (opts.drop?.length) text = dropHeaders(text, opts.drop);
  return new TextEncoder().encode(text);
}

/** Exactly the header set Gmail's metadata format would return for the fields the sync asks for. */
function headersOf(raw: Uint8Array): Record<string, string> {
  const parsed = parseMessage(raw);
  const headers: Record<string, string> = {};
  for (const name of METADATA_HEADERS) {
    const value = parsed.get(name);
    if (value !== null) headers[name] = value.split(/\s+/).filter(Boolean).join(" ");
  }
  return headers;
}

const ms = (when: Date) => String(when.getTime());

interface FakeMail {
  id: string;
  threadId: string;
  internalDate: string;
  headers: Record<string, string>;
  raw: Uint8Array;
}

/**
 * An in-memory Gmail read side: `listMessages` honours the query's `after:`
 * and pages two ids at a time (so pagination is exercised by every case),
 * `getMetadata` returns the provider's own shape, and either call can be
 * told to fail for one id or one whole sender.
 */
export class FakeReader implements InboxReader {
  readonly mail = new Map<string, FakeMail[]>();
  readonly raiseOnId = new Set<string>();
  readonly raiseOnList = new Set<string>();
  readonly queries: [string, string][] = [];
  readonly listOpts: { pageToken: string | null; maxResults: number; includeSpamTrash: boolean }[] =
    [];

  add(sender: string, gmailId: string, raw: Uint8Array, opts: { threadId: string; when: Date }) {
    const box = this.mail.get(sender) ?? [];
    box.push({
      id: gmailId,
      threadId: opts.threadId,
      internalDate: ms(opts.when),
      headers: headersOf(raw),
      raw,
    });
    this.mail.set(sender, box);
    return this;
  }

  private find(sender: string, gmailId: string): FakeMail {
    const found = (this.mail.get(sender) ?? []).find((m) => m.id === gmailId);
    if (!found) throw new Error(`no such message ${gmailId}`);
    return found;
  }

  async listMessages(
    sender: string,
    query: string,
    opts: { pageToken?: string | null; maxResults?: number; includeSpamTrash?: boolean },
  ): Promise<[string[], string | null]> {
    if (this.raiseOnList.has(sender)) throw new Error(`gmail 403: ${sender} is not readable`);
    this.queries.push([sender, query]);
    this.listOpts.push({
      pageToken: opts.pageToken ?? null,
      maxResults: opts.maxResults ?? 100,
      includeSpamTrash: opts.includeSpamTrash ?? false,
    });
    const after = Number(/after:(\d+)/.exec(query)?.[1] ?? "0") * 1000;
    const found = (this.mail.get(sender) ?? [])
      .filter((m) => Number(m.internalDate) >= after)
      .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    const start = opts.pageToken ? Number(opts.pageToken) : 0;
    const page = found.slice(start, start + 2);
    const following = start + 2 < found.length ? String(start + 2) : null;
    return [page.map((m) => m.id), following];
  }

  async getMetadata(
    sender: string,
    messageId: string,
    headers: readonly string[],
  ): Promise<MessageMetadata> {
    if (this.raiseOnId.has(messageId)) throw new Error(`gmail 500 reading ${messageId}`);
    const message = this.find(sender, messageId);
    const wanted = new Set(headers.map((h) => h.toLowerCase()));
    return {
      id: message.id,
      threadId: message.threadId,
      internalDate: message.internalDate,
      labelIds: [],
      payload: {
        headers: Object.entries(message.headers)
          .filter(([name]) => wanted.has(name.toLowerCase()))
          .map(([name, value]) => ({ name, value })),
      },
    };
  }

  async getRaw(sender: string, messageId: string): Promise<Uint8Array> {
    if (this.raiseOnId.has(messageId)) throw new Error(`gmail 500 reading ${messageId}`);
    return this.find(sender, messageId).raw;
  }
}
