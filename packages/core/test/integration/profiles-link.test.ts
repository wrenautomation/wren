/** A booker reached under another address joins that profile by name and domain. Synthetic rows. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveProfile } from "../../src/profiles.js";
import { linkBookers, linkByName } from "../../src/profiles-link.js";
import { recordTouch } from "../../src/touches.js";

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

/** Someone we invited on LinkedIn, with their company on file: the profile a booking should find. */
async function invited(name: string, domain: string | null, day = 2) {
  const [c] = await run(
    sql`insert into companies (name, domain) values ('Example Co', ${domain}) returning id`,
  );
  const [p] = await run(sql`
    insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw, created_at)
    values (${c?.id}, ${name}, false, 'website', 'test', '{}', ${T(day).toISOString()}) returning id`);
  const handle = `${name.toLowerCase().replace(/\s+/g, "-")}-${day}`;
  const prof = await resolveProfile(
    pg.db,
    [
      { kind: "person", value: Number(p?.id) },
      { kind: "handle:linkedin", value: handle },
    ],
    "people_import",
    { name, at: T(day) },
  );
  await recordTouch(pg.db, {
    platform: "linkedin",
    handle: `https://www.linkedin.com/in/${handle}`,
    kind: "connect",
    direction: "ours",
    at: T(day),
    source: "test",
    ref: handle,
  });
  return prof?.id as number;
}

const booked = async (name: string, email: string, day = 5) =>
  (
    await resolveProfile(pg.db, [{ kind: "email", value: email }], "call_booking", {
      name,
      at: T(day),
    })
  )?.id as number;

describe("linkByName", () => {
  it("joins a booker to the profile we invited when the email domain names their company", async () => {
    const reached = await invited("Pat Example", "patexample.io");
    const booker = await booked("Pat  example", "pat@patexample.com");
    const got = await linkByName(pg.db, booker, "call_booking", T(5));
    expect(got).toEqual({ merged: [booker], maybe: [], id: reached });
    const keys = await run(sql`select kind from profile_keys where profile_id = ${reached}`);
    expect(keys.map((k) => k.kind).sort()).toEqual(["email", "handle:linkedin", "person"]);
  });

  it("merges nothing on a name alone, and leaves a line when we reached the other", async () => {
    const reached = await invited("Pat Example", "other.example");
    const booker = await booked("Pat Example", "pat@unrelated.example");
    const got = await linkByName(pg.db, booker, "call_booking", T(5));
    expect(got).toEqual({ merged: [], maybe: [reached], id: booker });
    const [line] = await run(sql`select profile_id, kind, link from profile_events`);
    expect(line).toEqual({ profile_id: booker, kind: "merge", link: `/people/people/${reached}` });
    // Again: the same line, not a second.
    await linkByName(pg.db, booker, "call_booking", T(6));
    expect(await run(sql`select id from profile_events`)).toHaveLength(1);
  });

  it("reads nothing into a free mail host or a one-word name", async () => {
    await invited("Pat Example", "gmail.com");
    const booker = await booked("Pat Example", "pat@gmail.com");
    expect((await linkByName(pg.db, booker, "t")).merged).toEqual([]);
    await invited("Cher", "cher.example", 3);
    const solo = await booked("Cher", "cher@cher.example", 6);
    expect(await linkByName(pg.db, solo, "t")).toEqual({ merged: [], maybe: [], id: solo });
  });

  it("links bookings made before it ran", async () => {
    const reached = await invited("Pat Example", "patexample.io");
    const booker = await booked("Pat Example", "pat@patexample.co.uk");
    const got = await linkBookers(pg.db, T(7));
    expect(got).toEqual([{ merged: [booker], maybe: [], id: reached }]);
    expect(await linkBookers(pg.db, T(8))).toEqual([]);
  });
});
