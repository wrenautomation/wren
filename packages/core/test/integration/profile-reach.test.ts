/**
 * The person page's detail read on a real database: every email, phone and handle as a link,
 * the research row behind the `person` key, a profile with only an email, a merged one and one
 * with no lines. Synthetic rows; every time is fixed.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reachOf } from "../../src/profile-reach.js";
import { profileRecord } from "../../src/profile-records.js";
import { resolveProfile } from "../../src/profiles.js";
import { handleUrl } from "../../src/touches.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const T = (day: number) => new Date(Date.UTC(2026, 9, day, 12));

beforeEach(async () => {
  await truncate(pg.db, [
    "profile_events",
    "profile_merges",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
    "touches",
    "social_handles",
    "people",
    "companies",
  ]);
});

async function researched(title: string, company: string, linkedinUrl: string | null) {
  const [c] = await run(
    sql`insert into companies (name, domain) values (${company}, 'example.test') returning id`,
  );
  const [p] = await run(sql`
    insert into people (company_id, full_name, title, linkedin_url, is_compliance, origin, origin_ref, raw, created_at)
    values (${c?.id}, 'Ann Example', ${title}, ${linkedinUrl}, false, 'website', 'test', '{}', ${T(2).toISOString()})
    returning id`);
  return Number(p?.id);
}

describe("handleUrl", () => {
  it("builds a page from the handle alone, or says none", () => {
    expect(handleUrl("x", "ann_ex")).toBe("https://x.com/ann_ex");
    expect(handleUrl("reddit", "ann_ex")).toBe("https://www.reddit.com/user/ann_ex");
    expect(handleUrl("linkedin", "ann-example")).toBe("https://www.linkedin.com/in/ann-example/");
    expect(handleUrl("linkedin", "company:example-co")).toBe(
      "https://www.linkedin.com/company/example-co/",
    );
    expect(handleUrl("linkedin", "urn:li:member:12345")).toBeNull();
    expect(handleUrl("instagram", "name:ann example")).toBeNull();
    expect(handleUrl("tiktok", "ann_ex")).toBeNull();
  });
});

describe("reachOf", () => {
  it("lists every handle with its page, emails, phones and the research row", async () => {
    const person = await researched(
      "Head of Growth",
      "Example Co",
      "https://www.linkedin.com/in/Ann-Example",
    );
    const got = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "Ann@Example.test" },
        { kind: "phone", value: "(555) 010-0100" },
        { kind: "person", value: person },
        { kind: "handle:x", value: "ann_ex" },
        { kind: "handle:linkedin", value: "urn:li:member:12345" },
        { kind: "handle:reddit", value: "ann_ex" },
      ],
      "test",
      { name: "Ann Example", at: T(3) },
    );
    // A stored page wins over one built from the handle.
    await run(sql`insert into social_handles (platform, handle, url, name)
      values ('reddit', 'ann_ex', 'https://www.reddit.com/user/ann_ex/?stored=1', 'Ann on Reddit')`);
    const reach = await reachOf(pg.db, got?.id as number);
    expect(reach.emails).toEqual(["ann@example.test"]);
    expect(reach.phones).toEqual(["+15550100100"]);
    const by = Object.fromEntries(reach.handles.map((h) => [h.platform, h]));
    expect(by.x?.url).toBe("https://x.com/ann_ex");
    expect(by.reddit).toMatchObject({
      url: "https://www.reddit.com/user/ann_ex/?stored=1",
      name: "Ann on Reddit",
      label: "Reddit",
    });
    // A URN links to the vanity page of the research row, since it is known.
    expect(by.linkedin?.url).toBe("https://www.linkedin.com/in/ann-example/");
    expect(reach.person).toEqual({
      name: "Ann Example",
      title: "Head of Growth",
      company: "Example Co",
      linkedinUrl: "https://www.linkedin.com/in/ann-example/",
    });
  });

  it("gives a URN no link when no vanity is known", async () => {
    const got = await resolveProfile(
      pg.db,
      [{ kind: "handle:linkedin", value: "urn:li:member:99999" }],
      "test",
      {
        name: "Bob Example",
        at: T(3),
      },
    );
    const reach = await reachOf(pg.db, got?.id as number);
    expect(reach.handles).toMatchObject([{ platform: "linkedin", url: null }]);
    expect(reach.person).toBeNull();
  });

  it("reads a profile with only an email, and one with nothing", async () => {
    const got = await resolveProfile(
      pg.db,
      [{ kind: "email", value: "cat@example.test" }],
      "test",
      {
        name: "Cat Example",
        at: T(3),
      },
    );
    expect(await reachOf(pg.db, got?.id as number)).toEqual({
      emails: ["cat@example.test"],
      phones: [],
      handles: [],
      person: null,
    });
    expect(await reachOf(pg.db, 987_654)).toEqual({
      emails: [],
      phones: [],
      handles: [],
      person: null,
    });
  });
});

describe("the people.profile detail", () => {
  it("opens for a profile with handles, a merged one and one with no lines", async () => {
    const person = await researched("Founder", "Example Co", null);
    const ann = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "ann@example.test" },
        { kind: "person", value: person },
        { kind: "handle:x", value: "ann_ex" },
      ],
      "test",
      { name: "Ann Example", at: T(3) },
    );
    const dup = await resolveProfile(
      pg.db,
      [{ kind: "handle:instagram", value: "ann.ex" }],
      "test",
      {
        name: "Ann E",
        at: T(4),
      },
    );
    // The second profile folds into the first when one key joins them.
    await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "ann@example.test" },
        { kind: "handle:instagram", value: "ann.ex" },
      ],
      "test",
      { at: T(5) },
    );
    const load = profileRecord.load;
    if (!load) throw new Error("the profile has a detail read");
    const detail = (await load(pg.db, String(ann?.id))) as {
      total: number;
      failed: string[];
      reach: { handles: { platform: string }[]; person: { title: string } | null };
    };
    expect(detail.failed).toEqual([]);
    // The fold left a merge line, so the page has something on its timeline.
    expect(detail.total).toBeGreaterThan(0);
    expect(detail.reach.person?.title).toBe("Founder");
    expect(detail.reach.handles.map((h) => h.platform).sort()).toEqual(["instagram", "x"]);
    // The folded profile's page is gone; its handle moved to the one that stayed.
    expect(dup?.id).not.toBe(ann?.id);
  });

  it("opens a profile with no lines: empty parts, nothing failed", async () => {
    const dee = await resolveProfile(
      pg.db,
      [{ kind: "email", value: "dee@example.test" }],
      "test",
      {
        name: "Dee Example",
        at: T(3),
      },
    );
    const load = profileRecord.load;
    const detail = (await load?.(pg.db, String(dee?.id))) as {
      total: number;
      lines: unknown[];
      failed: string[];
      reach: { emails: string[]; handles: unknown[] };
    };
    expect(detail.failed).toEqual([]);
    expect(detail.lines).toEqual([]);
    expect(detail.reach.emails).toEqual(["dee@example.test"]);
    expect(detail.reach.handles).toEqual([]);
  });

  it("says nothing for an id that is not a number", async () => {
    const load = profileRecord.load;
    expect(await load?.(pg.db, "abc")).toBeNull();
  });
});
