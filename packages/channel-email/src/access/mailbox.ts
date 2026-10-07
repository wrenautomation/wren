/**
 * A client's connected mailbox as the Monitor's `Mailbox` (designs/2026-10-07-mail-access.md):
 * Gmail's REST API or Microsoft Graph, on the mailbox's own OAuth token. Headers and the
 * provider's preview only; the reader never asks for a body. `token` hands a live access token.
 */
import { decodeHtml } from "@wren/core/html";
import { type Mailbox, type MailMeta, metaOf } from "@wren/core/mailbox";
import type { FetchLike } from "../fetch-like.js";

export type TokenOf = () => Promise<string>;

/** A provider call that failed: `status` 401 or 403 means the token or its scopes are gone. */
export class MailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MailApiError";
  }
}

async function getJson<T>(fetch: FetchLike, url: string, token: TokenOf): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await token()}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new MailApiError(
      res.status,
      `${res.status}: ${String(body.error?.message ?? res.statusText).slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

async function getBytes(fetch: FetchLike, url: string, token: TokenOf): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new MailApiError(res.status, `${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/** A Gmail or Workspace mailbox on its own token (gmail.readonly). */
export function gmailMailbox(fetch: FetchLike, address: string, token: TokenOf): Mailbox {
  const message = (id: string, q: string) => `${GMAIL}/messages/${encodeURIComponent(id)}?${q}`;
  return {
    address,
    async search(query) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({ q: query, maxResults: "100" });
        if (pageToken) q.set("pageToken", pageToken);
        const page = await getJson<{ messages?: { id: string }[]; nextPageToken?: string }>(
          fetch,
          `${GMAIL}/messages?${q}`,
          token,
        );
        ids.push(...(page.messages ?? []).map((m) => m.id));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return ids;
    },
    async raw(id) {
      const { raw } = await getJson<{ raw: string }>(fetch, message(id, "format=raw"), token);
      return new Uint8Array(Buffer.from(raw, "base64url"));
    },
    meta: async (id) =>
      metaOf(
        await getJson(
          fetch,
          message(id, "format=metadata&metadataHeaders=From&metadataHeaders=Subject"),
          token,
        ),
      ),
  };
}

/** One read that proves the token reads: the newest message id, or none. */
export async function gmailReads(fetch: FetchLike, token: TokenOf): Promise<void> {
  await getJson(fetch, `${GMAIL}/messages?maxResults=1`, token);
}

const GRAPH = "https://graph.microsoft.com/v1.0/me";
/** Graph's `after:` stand-in: the Monitor's query names a Unix second; Graph takes ISO. */
const AFTER = /\bafter:(\d+)\b/;

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string | null;
  receivedDateTime?: string;
  webLink?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
};

/** A Graph message as `MailMeta`: Outlook's own link to open it. */
export function graphMetaOf(m: GraphMessage): MailMeta {
  return {
    id: m.id,
    threadId: m.conversationId ?? m.id,
    fromName: m.from?.emailAddress?.name ?? "",
    fromAddress: (m.from?.emailAddress?.address ?? "").toLowerCase(),
    subject: m.subject ?? "",
    snippet: decodeHtml(m.bodyPreview ?? ""),
    at: new Date(m.receivedDateTime ?? 0),
    link: m.webLink ?? null,
  };
}

/**
 * A Microsoft 365 mailbox on its own token (Mail.Read). The Monitor's Gmail query is read for its
 * `after:` alone: the inbox folder since then. Outlook has no promotions tab to skip.
 */
export function graphMailbox(fetch: FetchLike, address: string, token: TokenOf): Mailbox {
  const message = (id: string) => `${GRAPH}/messages/${encodeURIComponent(id)}`;
  return {
    address,
    async search(query) {
      const after = AFTER.exec(query)?.[1];
      const q = new URLSearchParams({ $select: "id", $top: "100" });
      if (after) {
        q.set("$filter", `receivedDateTime ge ${new Date(Number(after) * 1000).toISOString()}`);
        q.set("$orderby", "receivedDateTime desc");
      }
      const ids: string[] = [];
      let next: string | undefined = `${GRAPH}/mailFolders/inbox/messages?${q}`;
      while (next) {
        // Only Graph's own next link is followed.
        if (!next.startsWith("https://graph.microsoft.com/")) break;
        const page: { value?: { id: string }[]; "@odata.nextLink"?: string } = await getJson(
          fetch,
          next,
          token,
        );
        ids.push(...(page.value ?? []).map((m) => m.id));
        next = page["@odata.nextLink"];
      }
      return ids;
    },
    raw: (id) => getBytes(fetch, `${message(id)}/$value`, token),
    meta: async (id) =>
      graphMetaOf(
        await getJson<GraphMessage>(
          fetch,
          `${message(id)}?$select=id,conversationId,from,subject,bodyPreview,receivedDateTime,webLink`,
          token,
        ),
      ),
  };
}

/** One read that proves the token reads Outlook mail. */
export async function graphReads(fetch: FetchLike, token: TokenOf): Promise<void> {
  await getJson(fetch, `${GRAPH}/mailFolders/inbox/messages?$top=1&$select=id`, token);
}
