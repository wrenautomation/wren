/**
 * Plaid card feeds against the migrated schema, with a scripted Plaid: link, pending then
 * posted, an alert taken over, a removed line, and a lapsed sign-in. All data is made up.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import type { PlaidApi, Transaction } from "plaid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cardFeeds,
  cardLines,
  dirStore,
  documents,
  feedAccess,
  finishLink,
  seedBooks,
  syncFeeds,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

let root: string;
beforeEach(async () => {
  await pg.db.execute(
    sql.raw(
      `TRUNCATE ${["card_feeds", "card_rules", "card_lines", "bill_documents", "bills", "documents", "vendors", "accounts"].map((t) => `books.${t}`).join(", ")} RESTART IDENTITY CASCADE`,
    ),
  );
  await seedBooks(pg.db);
  root = await mkdtemp(join(tmpdir(), "plaid-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const tx = (id: string, o: Partial<Transaction> = {}) =>
  ({
    transaction_id: id,
    account_id: "acc-1",
    amount: 15.52,
    iso_currency_code: "CAD",
    unofficial_currency_code: null,
    date: "2026-10-08",
    authorized_date: "2026-10-07",
    name: "X Corp",
    original_description: "X CORP. PAID FEATURES",
    pending: false,
    pending_transaction_id: null,
    ...o,
  }) as Transaction;

type Page = { added?: Transaction[]; modified?: Transaction[]; removed?: string[] };

/** A Plaid that answers each sync with the next page of `script`, keyed by cursor. */
function scripted(script: Page[], calls: string[] = []) {
  return {
    transactionsSync: async (r: { cursor?: string }) => {
      const at = r.cursor ? Number(r.cursor.slice(1)) : 0;
      calls.push(r.cursor ?? "start");
      const p = script[at] ?? {};
      return {
        data: {
          added: p.added ?? [],
          modified: p.modified ?? [],
          removed: (p.removed ?? []).map((transaction_id) => ({ transaction_id })),
          next_cursor: `c${at + 1}`,
          has_more: at + 1 < script.length,
          accounts: [],
          request_id: `r${at}`,
        },
      };
    },
  } as unknown as PlaidApi;
}

const addFeed = () =>
  pg.db
    .insert(cardFeeds)
    .values({
      card: "1234",
      itemId: "item-1",
      accountId: "acc-1",
      keyLabel: "PLAID_ACCESS_TOKEN_1234",
    });

describe("Plaid card feed", () => {
  it("links: seals the token and adds the feed by the card's last four", async () => {
    const kept: unknown[] = [];
    const api = {
      linkTokenGet: async () => ({
        data: {
          link_sessions: [
            {
              results: {
                item_add_results: [{ public_token: "public-x", institution: { name: "Bank" } }],
              },
            },
          ],
        },
      }),
      itemPublicTokenExchange: async () => ({
        data: { access_token: "access-sandbox-t", item_id: "item-1" },
      }),
      accountsGet: async () => ({
        data: {
          accounts: [
            { account_id: "acc-0", mask: "9999" },
            { account_id: "acc-1", mask: "1234" },
          ],
        },
      }),
    } as unknown as PlaidApi;
    const feed = await finishLink(pg.db, api, async (k) => kept.push(k), {
      linkToken: "link-x",
      card: "1234",
    });
    expect(feed).toMatchObject({ card: "1234", accountId: "acc-1", institution: "Bank" });
    expect(kept).toEqual([{ name: "PLAID_ACCESS_TOKEN_1234", value: "access-sandbox-t" }]);
  });

  it("pending then posted is one line; an alert is taken over; a removed line goes", async () => {
    await addFeed();
    const [doc] = await pg.db
      .insert(documents)
      .values({
        sha256: "alert-1",
        mediaType: "message/rfc822",
        size: 1,
        storeKey: "a1",
        source: "mailbox",
      })
      .returning();
    await pg.db.insert(cardLines).values({
      card: "1234",
      on: "2026-10-06",
      description: "X CORP",
      descriptor: "X CORP",
      amountCents: 1552,
      currency: "CAD",
      source: "alert",
      fingerprint: "alert:1",
      documentId: doc?.id as number,
    });
    const script: Page[] = [
      {
        added: [
          tx("t1"),
          tx("p2", { amount: 4, name: "Cafe", original_description: "CORNER CAFE", pending: true }),
        ],
      },
      {
        added: [
          tx("t2", {
            amount: 4.5,
            name: "Cafe",
            original_description: "CORNER CAFE",
            pending_transaction_id: "p2",
          }),
        ],
        removed: ["p2"],
      },
    ];
    const calls: string[] = [];
    const access = async () => ({ api: scripted(script, calls), token: "access-sandbox-t" });
    const got = await syncFeeds(pg.db, dirStore(root), access);
    expect(got.open).toEqual([]);
    expect(got.feeds[0]).toMatchObject({
      pages: 2,
      added: 1,
      confirmed: 1,
      modified: 1,
      removed: 0,
    });
    const rows = await pg.db.select().from(cardLines).orderBy(cardLines.id);
    expect(rows.map((r) => [r.source, r.fingerprint, r.amountCents, r.on])).toEqual([
      ["plaid", "plaid:t1", 1552, "2026-10-07"],
      ["plaid", "plaid:t2", 450, "2026-10-07"],
    ]);
    const kept = await pg.db.select().from(documents).where(eq(documents.source, "plaid"));
    expect(kept).toHaveLength(2);
    const [f] = await pg.db.select().from(cardFeeds);
    expect(f).toMatchObject({ cursor: "c2", error: null });

    // next day: from the stored cursor; Plaid drops t1
    script.push({ removed: ["t1"] });
    const again = await syncFeeds(pg.db, dirStore(root), access);
    expect(calls.at(-1)).toBe("c2");
    expect(again.feeds[0]).toMatchObject({ removed: 1 });
    expect(await pg.db.select().from(cardLines)).toHaveLength(1);
  });

  it("a lapsed sign-in keeps the cursor and raises a card condition", async () => {
    await addFeed();
    const api = {
      transactionsSync: async () => {
        throw Object.assign(new Error("400"), {
          response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "sign in again" } },
        });
      },
    } as unknown as PlaidApi;
    const got = await syncFeeds(pg.db, dirStore(root), async () => ({ api, token: "t" }));
    expect(got.open).toEqual([expect.objectContaining({ key: "card:feed:1234", kind: "card" })]);
    const [f] = await pg.db.select().from(cardFeeds);
    expect(f?.error).toMatch(/^ITEM_LOGIN_REQUIRED/);
    expect(f?.cursor).toBeNull();
  });
});

describe("feedAccess", () => {
  it("reads the token by name and picks sandbox or production from its prefix", async () => {
    const vars = {
      PLAID_CLIENT_ID: "id",
      PLAID_SANDBOX_SECRET: "s",
      PLAID_ACCESS_TOKEN_1234: "access-sandbox-t",
    };
    expect((await feedAccess(vars)("PLAID_ACCESS_TOKEN_1234")).token).toBe("access-sandbox-t");
    await expect(feedAccess(vars)("PLAID_ACCESS_TOKEN_9999")).rejects.toThrow(/no PLAID_ACCESS/);
    const prod = { ...vars, PLAID_ACCESS_TOKEN_1234: "access-production-t" };
    await expect(feedAccess(prod)("PLAID_ACCESS_TOKEN_1234")).rejects.toThrow(/PLAID_SECRET/);
  });
});
