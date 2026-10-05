/**
 * The instagram stage on a real Postgres with a fake autobrowse: who is due and in what order, what
 * one read keeps, how a missing account, a rate limit and an error each end. Synthetic data only.
 */
import { imports, leads } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type InstagramAnswer,
  instagramDue,
  instagramRoom,
  instagramUnit,
  instagramWork,
} from "../../src/enrichment/instagram.js";
import { contactPoints } from "../../src/schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "contact_points", "findings", "leads", "imports"]));
const db = () => pg.db;

const firm = async (k: string, link: string | null, mailable = false) => {
  const c = await makeCompany(db(), { key: k, domain: `${k}.example`, niche: "recruiting" });
  if (link)
    await db()
      .insert(contactPoints)
      .values({
        companyId: c.id,
        kind: "instagram",
        value: link,
        source: "link",
        sourceUrl: `https://${k}.example/`,
      });
  if (mailable) {
    const [batch] = await db()
      .insert(imports)
      .values({ sourceType: "test", sourceRef: "inline", stats: {} })
      .returning({ id: imports.id });
    await db()
      .insert(leads)
      .values({
        email: `a@${k}.example`,
        status: "verified",
        raw: {},
        importId: (batch as { id: number }).id,
        companyId: c.id,
      });
  }
  return c.id;
};

const FOUND: InstagramAnswer = {
  found: true,
  profile: { id: "1789", username: "firm.one", followers_count: 5 },
  media: [
    {
      id: "m1",
      permalink: "https://www.instagram.com/p/AAA/",
      timestamp: "2026-09-30T21:40:31+0000",
    },
    {
      id: "m2",
      permalink: "https://www.instagram.com/p/BBB/",
      timestamp: "2026-09-29T10:00:00+0000",
    },
  ],
};
const sites = (answer: () => unknown): SiteClient & { paths: string[] } => {
  const paths: string[] = [];
  return {
    paths,
    via: async () => "none",
    call: async (_site, _method, path) => {
      paths.push(path);
      return answer() as never;
    },
  };
};
const kept = async () =>
  (
    await db().execute<{ kind: string; via: string; url: string | null }>(
      sql`select kind, via, source_url as url from findings order by id`,
    )
  ).map((r) => `${r.kind}:${r.via}:${r.url ?? ""}`);

describe("instagramWork", () => {
  it("mailable firms first, only firms with a link, none read within 30 days", async () => {
    const plain = await firm("a", "https://www.instagram.com/a.firm/");
    const mail = await firm("b", "https://www.instagram.com/b.firm/", true);
    await firm("c", null);
    const done = await firm("d", "https://www.instagram.com/d.firm/");
    const s = sites(() => FOUND);
    await instagramUnit(db(), s, { companyId: done, link: "https://www.instagram.com/d.firm/" });
    const work = await instagramWork(db(), { niche: "recruiting", limit: 10 });
    expect(work.map((w) => w.companyId)).toEqual([mail, plain]);
    expect(await instagramWork(db(), { niche: "other", limit: 10 })).toEqual([]);
  });
});

describe("instagramUnit", () => {
  it("keeps the profile and each post, asks for the username, and the firm is no longer due", async () => {
    const id = await firm("a", "https://www.instagram.com/firm.one/");
    const s = sites(() => FOUND);
    const u = await instagramUnit(db(), s, {
      companyId: id,
      link: "https://www.instagram.com/firm.one/",
    });
    expect(u).toMatchObject({ outcome: "read", posts: 2 });
    expect(s.paths).toEqual(["/instagram/firm.one"]);
    expect(await kept()).toEqual([
      "profile:instagram:https://www.instagram.com/firm.one/",
      "post:instagram:https://www.instagram.com/p/AAA/",
      "post:instagram:https://www.instagram.com/p/BBB/",
    ]);
    const [r] = await db().execute<{ due: boolean }>(
      sql`select ${instagramDue(sql`${id}::int`)} due`,
    );
    expect(r?.due).toBe(false);
    const [post] = await db().execute<{ day: string }>(
      sql`select value->>'published_at' as day from findings where kind = 'post' order by id limit 1`,
    );
    expect(post?.day).toBe("2026-09-30T21:40:31.000Z");
  });

  it("found:false is a missing profile finding, not read again within 30 days", async () => {
    const id = await firm("a", "https://www.instagram.com/gone/");
    const s = sites(() => ({ found: false, reason: "not a business account" }));
    const u = await instagramUnit(db(), s, {
      companyId: id,
      link: "https://www.instagram.com/gone/",
    });
    expect(u.outcome).toBe("missing");
    expect(await kept()).toEqual(["profile:instagram:https://www.instagram.com/gone/"]);
    expect(await instagramWork(db(), { niche: "recruiting", limit: 5 })).toEqual([]);
  });

  it("a link that names no profile is missing without a call", async () => {
    const id = await firm("a", "https://www.instagram.com/");
    const s = sites(() => FOUND);
    const u = await instagramUnit(db(), s, { companyId: id, link: "https://www.instagram.com/" });
    expect(u.outcome).toBe("missing");
    expect(s.paths).toEqual([]);
  });

  it("a 429 is capped and keeps nothing; any other error is an error, answered as data", async () => {
    const id = await firm("a", "https://www.instagram.com/firm.one/");
    const w = { companyId: id, link: "https://www.instagram.com/firm.one/" };
    const capped = await instagramUnit(
      db(),
      sites(() => {
        throw new SiteCallError(
          "meta",
          "GET",
          "/instagram/firm.one",
          429,
          "limit; retry after 90s",
        );
      }),
      w,
    );
    const broke = await instagramUnit(
      db(),
      sites(() => {
        throw new SiteCallError("meta", "GET", "/instagram/firm.one", 502, "bad gateway");
      }),
      w,
    );
    expect([capped.outcome, broke.outcome]).toEqual(["capped", "error"]);
    expect(await kept()).toEqual([]);
  });
});

describe("instagramRoom", () => {
  it("a full bucket at first; reads spend it", async () => {
    expect((await instagramRoom(db(), new Date())).room).toBe(150);
    const id = await firm("a", "https://www.instagram.com/firm.one/");
    await instagramUnit(
      db(),
      sites(() => FOUND),
      { companyId: id, link: "https://www.instagram.com/firm.one/" },
    );
    expect((await instagramRoom(db(), new Date())).room).toBe(149);
  });
});
