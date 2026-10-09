/**
 * A TikTok draft against Postgres (designs/2026-10-07-client-social.md, TikTok Direct Post): no
 * yes before who can see it is picked or with a disclosure left empty, the row says which so the
 * portal holds Approve, a settings change after the yes asks for it again, and the client's form
 * reads the account TikTok answers. Synthetic clients, drafts and creator only; nothing posts.
 */
import { addClient, addOperator } from "@wren/core/clients";
import type { TikTokCreator } from "@wren/core/content/tiktok";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addIdea, contentDrafts } from "../../src/index.js";
import { CONTENT_RECORDS } from "../../src/records.js";
import { marketingConsoleApi } from "../../src/restate/marketing-console.js";
import { approveDrafts, setFields } from "../../src/review.js";

let pg: TestPostgres;
let rho: Db;
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const operator = { viewer: { email: "op@example.test", operator: true } };

const CREATOR: TikTokCreator = {
  nickname: "Rho Bakery",
  username: "rhobakery",
  avatarUrl: null,
  privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
  commentOff: false,
  duetOff: true,
  stitchOff: false,
  maxVideoSec: 60,
  canPost: true,
  why: null,
};

async function tiktokDraft(db: Db): Promise<string> {
  const idea = await addIdea(db, "Fresh bread at six.", "cli");
  const [row] = await db
    .insert(contentDrafts)
    .values({
      ideaId: idea.id,
      platform: "tiktok",
      text: "Fresh bread at six.",
      status: "draft",
      promptVersion: "test",
    })
    .returning({ id: contentDrafts.id });
  if (!row) throw new Error("no draft");
  return row.id;
}

const missing = async (db: Db, id: string) =>
  (
    await db.execute<{ missing: string | null }>(
      sql`select missing from marketing_draft_records where id = ${id}`,
    )
  )[0]?.missing ?? null;
const status = async (db: Db, id: string) =>
  (await db.select().from(contentDrafts).where(eq(contentDrafts.id, id)))[0]?.status;

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "rho", name: "Rho", products: { "marketing.stats": {} } });
  await addOperator(pg.db, "op@example.test");
  rho = open("rho");
}, 180_000);
afterAll(async () => {
  await pg?.stop();
});

describe("tiktok draft", () => {
  it("holds the yes until privacy and a disclosure choice are picked", async () => {
    const id = await tiktokDraft(rho);
    const now = new Date();
    expect(await missing(rho, id)).toBe("privacy");
    await expect(approveDrafts(rho, [id], { now, at: now })).rejects.toThrow(/Who can see it/);

    await setFields(rho, id, { privacy: "PUBLIC_TO_EVERYONE", disclose: true });
    expect(await missing(rho, id)).toBe("disclosure");
    await expect(approveDrafts(rho, [id], { now, at: now })).rejects.toThrow(
      /indicate if your content promotes yourself/,
    );

    await setFields(rho, id, { brandedContent: true });
    expect(await missing(rho, id)).toBeNull();
    await expect(setFields(rho, id, { privacy: "SELF_ONLY" })).rejects.toThrow(
      "Branded content visibility cannot be set to private.",
    );
    await approveDrafts(rho, [id], { now, at: now });
    expect(await status(rho, id)).toBe("approved");
  });

  it("a settings change after the yes asks for it again", async () => {
    const id = await tiktokDraft(rho);
    const now = new Date();
    await setFields(rho, id, { privacy: "SELF_ONLY" });
    await approveDrafts(rho, [id], { now, at: now });
    expect(await status(rho, id)).toBe("approved");
    await setFields(rho, id, { allowComment: true });
    expect(await status(rho, id)).toBe("draft");
  });

  it("the client's form reads the account as TikTok answers, kept half a minute", async () => {
    const id = await tiktokDraft(rho);
    let reads = 0;
    const api = marketingConsoleApi({
      db: pg.db,
      open: (c) => open(c.id),
      records: CONTENT_RECORDS,
      tiktokCreator: async (client) => {
        reads += 1;
        return client === "rho" ? CREATOR : null;
      },
    });
    const get = () =>
      api.recordsGet({ ...operator, client: "rho", record: "marketing.draft", id }) as Promise<{
        detail: { shape: { tiktok?: { creator: TikTokCreator | null } } };
      }>;
    expect((await get()).detail.shape.tiktok?.creator).toEqual(CREATOR);
    await get();
    expect(reads).toBe(1);

    const none = marketingConsoleApi({
      db: pg.db,
      open: (c) => open(c.id),
      records: CONTENT_RECORDS,
      tiktokCreator: async () => null,
    });
    const out = (await none.recordsGet({
      ...operator,
      client: "rho",
      record: "marketing.draft",
      id,
    })) as { detail: { shape: { tiktok?: { creator: unknown; note: string | null } } } };
    expect(out.detail.shape.tiktok).toMatchObject({ creator: null, note: /Connect/ });
  });
});
