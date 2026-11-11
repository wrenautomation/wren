/**
 * Card lines from Plaid Transactions (WA-1276). A card is linked once through Plaid's hosted
 * Link page; each books day then pulls `/transactions/sync` from the stored cursor. Every page
 * Plaid returns is kept as a `plaid` document. Lines follow Plaid: added, modified, removed; a
 * posted line takes over its pending line, and a new line takes over the alert mail it repeats.
 */
import { errorText } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { serializable, type Tx } from "@wren/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type Transaction,
  type TransactionsSyncResponse,
} from "plaid";
import type { Condition } from "./alerts.js";
import { descriptorOf } from "./card.js";
import { shiftDay } from "./day.js";
import { cardFeeds, cardLines, documents } from "./schema.js";
import { type DocumentStore, sha256, storeKey } from "./store.js";

export type PlaidEnv = "production" | "sandbox";

/** Wren's own Plaid keys, kept under client `wren`: id unlabelled, secret labelled by env. */
const WREN = "wren";
const TOKEN = "PLAID_ACCESS_TOKEN";

export function plaidApi(o: { clientId: string; secret: string; env: PlaidEnv }): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[o.env] as string,
      baseOptions: { headers: { "PLAID-CLIENT-ID": o.clientId, "PLAID-SECRET": o.secret } },
    }),
  );
}

/** Plaid's error code on a failed call (`ITEM_LOGIN_REQUIRED`), else the error's text. */
function plaidError(err: unknown): string {
  const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } })
    .response?.data;
  return data?.error_code
    ? `${data.error_code}: ${data.error_message ?? ""}`.trim()
    : errorText(err);
}

/** A hosted Link page for one card: the URL to open, and the token `finishLink` reads it back by. */
export async function startLink(api: PlaidApi, o: { card: string }) {
  const { data } = await api.linkTokenCreate({
    client_name: "Wren Automation",
    language: "en",
    country_codes: [CountryCode.Ca],
    user: { client_user_id: `wren-card-${o.card}` },
    products: [Products.Transactions],
    // the most history Plaid gives; only asked at link time
    transactions: { days_requested: 730 },
    hosted_link: { url_lifetime_seconds: 3600 },
  });
  if (!data.hosted_link_url) throw new Error("Plaid gave no hosted link");
  return { url: data.hosted_link_url, linkToken: data.link_token, expires: data.expiration };
}

/**
 * After the person signs in on the hosted page: trade the public token, find the card's account
 * by its last four, seal the access token and add the feed. Null: the page is not done yet.
 */
export async function finishLink(
  db: Db,
  api: PlaidApi,
  put: (o: { name: string; label: string; value: string }) => Promise<unknown>,
  o: { linkToken: string; card: string },
) {
  const { data } = await api.linkTokenGet({ link_token: o.linkToken });
  const added = data.link_sessions
    ?.flatMap((s) => s.results?.item_add_results ?? [])
    .find((r) => r.public_token);
  if (!added) return null;
  const { data: x } = await api.itemPublicTokenExchange({ public_token: added.public_token });
  const { data: acc } = await api.accountsGet({ access_token: x.access_token });
  const account = acc.accounts.find((a) => a.mask === o.card);
  if (!account)
    throw new Error(
      `no account ending ${o.card} on this login (found ${acc.accounts.map((a) => a.mask ?? "?").join(", ")})`,
    );
  const keyLabel = `card-${o.card}`;
  await put({ name: TOKEN, label: keyLabel, value: x.access_token });
  const row = {
    card: o.card,
    institution: added.institution?.name ?? null,
    itemId: x.item_id,
    accountId: account.account_id,
    keyLabel,
    error: null,
  };
  const [feed] = await db
    .insert(cardFeeds)
    .values(row)
    // a new link for the same account: new token, start over
    .onConflictDoUpdate({ target: cardFeeds.accountId, set: { ...row, cursor: null } })
    .returning();
  return feed;
}

/** Plaid's API and a feed's access token, read from the key store at sync time. */
export type FeedAccess = (keyLabel: string) => Promise<{ api: PlaidApi; token: string }>;

type Named = (o: { name: string; label?: string; why: string }) => Promise<string | null>;

/** The worker's access: Wren's keys from the key store; the env from the token's prefix. */
export function feedAccess(named: Named): FeedAccess {
  const need = async (name: string, label: string | undefined, why: string) => {
    const v = await named({ name, ...(label ? { label } : {}), why });
    if (!v) throw new Error(`no ${name}${label ? `@${label}` : ""} under client ${WREN}`);
    return v;
  };
  return async (keyLabel) => {
    const why = `books card feed ${keyLabel}`;
    const token = await need(TOKEN, keyLabel, why);
    const env: PlaidEnv = token.startsWith("access-sandbox-") ? "sandbox" : "production";
    const [clientId, secret] = await Promise.all([
      need("PLAID_CLIENT_ID", undefined, why),
      need("PLAID_SECRET", env, why),
    ]);
    return { api: plaidApi({ clientId, secret, env }), token };
  };
}

interface FeedSync {
  card: string;
  pages: number;
  added: number;
  modified: number;
  removed: number;
  /** Alert lines a Plaid line took over. */
  confirmed: number;
  error: string | null;
}

/** Every page from the feed's cursor to the end; a change mid-way starts the pages over. */
async function pullPages(api: PlaidApi, token: string, accountId: string, from: string | null) {
  for (let attempt = 0; ; attempt++) {
    const pages: TransactionsSyncResponse[] = [];
    let cursor = from ?? undefined;
    try {
      for (;;) {
        const { data } = await api.transactionsSync({
          access_token: token,
          ...(cursor ? { cursor } : {}),
          count: 500,
          options: { include_original_description: true, account_id: accountId },
        });
        pages.push(data);
        cursor = data.next_cursor;
        if (!data.has_more) return pages;
      }
    } catch (err) {
      if (attempt < 2 && plaidError(err).startsWith("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"))
        continue;
      throw err;
    }
  }
}

/** A Plaid transaction as a card line's fields; Plaid's sign already matches (a charge is positive). */
function lineOf(card: string, t: Transaction, documentId: number) {
  const description = t.original_description || t.name;
  return {
    card,
    on: t.authorized_date ?? t.date,
    description,
    descriptor: descriptorOf(description),
    amountCents: Math.round(t.amount * 100),
    currency: (t.iso_currency_code ?? t.unofficial_currency_code ?? "CAD").toUpperCase(),
    source: "plaid" as const,
    fingerprint: `plaid:${t.transaction_id}`,
    documentId,
  };
}

const byPrint = (fp: string) => eq(cardLines.fingerprint, fp);

/** Add one transaction: over its pending line, else over the alert it repeats, else new. */
async function addLine(tx: Tx, fields: ReturnType<typeof lineOf>, pendingId: string | null) {
  const [known] = await tx
    .select({ id: cardLines.id })
    .from(cardLines)
    .where(byPrint(fields.fingerprint));
  if (known) {
    await tx.update(cardLines).set(fields).where(eq(cardLines.id, known.id));
    return "known";
  }
  if (pendingId) {
    const [pending] = await tx
      .select({ id: cardLines.id })
      .from(cardLines)
      .where(byPrint(`plaid:${pendingId}`));
    if (pending) {
      await tx.update(cardLines).set(fields).where(eq(cardLines.id, pending.id));
      return "posted";
    }
  }
  const [alert] = await tx
    .select({ id: cardLines.id })
    .from(cardLines)
    .where(
      and(
        eq(cardLines.source, "alert"),
        eq(cardLines.card, fields.card),
        eq(cardLines.amountCents, fields.amountCents),
        sql`${cardLines.on} between ${shiftDay(fields.on, -4)} and ${shiftDay(fields.on, 4)}`,
      ),
    )
    .orderBy(sql`abs(${cardLines.on} - ${fields.on}::date)`, asc(cardLines.id))
    .limit(1);
  if (alert) {
    await tx.update(cardLines).set(fields).where(eq(cardLines.id, alert.id));
    return "confirmed";
  }
  await tx.insert(cardLines).values(fields);
  return "added";
}

/** Keep one page as a document; the same bytes are one row. */
async function keepPage(
  db: Db,
  store: DocumentStore,
  page: TransactionsSyncResponse,
  runId: string | null,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(page));
  const hash = sha256(bytes);
  const mediaType = "application/json";
  const key = storeKey(hash, mediaType);
  await store.put(key, bytes, mediaType);
  await db
    .insert(documents)
    .values({
      sha256: hash,
      mediaType,
      size: bytes.byteLength,
      storeKey: key,
      source: "plaid",
      filename: `transactions-sync-${page.request_id}.json`,
      kind: "other",
      readAt: new Date(),
      runId,
    })
    .onConflictDoNothing({ target: documents.sha256 });
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.sha256, hash));
  if (!doc) throw new Error("Plaid page not kept");
  return doc.id;
}

async function syncFeed(
  db: Db,
  store: DocumentStore,
  access: FeedAccess,
  feed: typeof cardFeeds.$inferSelect,
  runId: string | null,
): Promise<FeedSync> {
  const out: FeedSync = {
    card: feed.card,
    pages: 0,
    added: 0,
    modified: 0,
    removed: 0,
    confirmed: 0,
    error: null,
  };
  try {
    const { api, token } = await access(feed.keyLabel);
    const pages = await pullPages(api, token, feed.accountId, feed.cursor);
    const docs: number[] = [];
    for (const p of pages) docs.push(await keepPage(db, store, p, runId));
    out.pages = pages.length;
    await serializable(db, async (tx) => {
      out.added = out.modified = out.removed = out.confirmed = 0;
      for (const [i, p] of pages.entries()) {
        const doc = docs[i] as number;
        // added first: a posted line in `added` takes over the pending one `removed` names
        for (const t of p.added) {
          const r = await addLine(tx, lineOf(feed.card, t, doc), t.pending_transaction_id ?? null);
          if (r === "confirmed") out.confirmed++;
          else if (r === "added") out.added++;
          else out.modified++;
        }
        for (const t of p.modified) {
          await tx
            .update(cardLines)
            .set(lineOf(feed.card, t, doc))
            .where(byPrint(`plaid:${t.transaction_id}`));
          out.modified++;
        }
        for (const t of p.removed) {
          const gone = await tx
            .delete(cardLines)
            .where(byPrint(`plaid:${t.transaction_id}`))
            .returning({ id: cardLines.id });
          out.removed += gone.length;
        }
      }
      const cursor = pages.at(-1)?.next_cursor ?? feed.cursor;
      await tx
        .update(cardFeeds)
        .set({ cursor, error: null, syncedAt: new Date() })
        .where(eq(cardFeeds.id, feed.id));
    });
  } catch (err) {
    out.error = plaidError(err);
    await db.update(cardFeeds).set({ error: out.error }).where(eq(cardFeeds.id, feed.id));
  }
  return out;
}

/** Pull every linked card; a failing feed is a `card` condition, not a failed day. */
export async function syncFeeds(
  db: Db,
  store: DocumentStore,
  access: FeedAccess,
  runId: string | null = null,
): Promise<{ feeds: FeedSync[]; open: Condition[] }> {
  const feeds = [];
  for (const f of await db.select().from(cardFeeds).orderBy(asc(cardFeeds.id)))
    feeds.push(await syncFeed(db, store, access, f, runId));
  const open = feeds.flatMap((f): Condition[] =>
    f.error
      ? [
          {
            key: `card:feed:${f.card}`,
            kind: "card",
            message: `card ${f.card} feed failed (${f.error}); if the bank sign-in lapsed: wren books plaid link --card ${f.card}`,
          },
        ]
      : [],
  );
  return { feeds, open };
}
