/**
 * Adversarial cases for the portal API over the seeded demo list: inputs a
 * browser can send that the handlers must answer or refuse cleanly, and
 * logins reaching past their own client. Anything but an answer or a
 * PortalRefusal becomes a non-terminal error, which Restate retries forever.
 */
import { addMember, clients } from "@wren/core/clients";
import { portalMe, type Viewer } from "@wren/core/portal";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { DEMO_NAME, PortalRefusal, portalApi } from "../../src/portal/service.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
const me = (r: { viewer: Viewer }) => portalMe(pg.db, r.viewer, DEMO_NAME);
let api: ReturnType<typeof portalApi>;
let jane: number;

const personId = async (full: string) => {
  const [r] = await pg.db.execute<{ id: number }>(
    sql`select id from people where full_name = ${full}`,
  );
  if (!r) throw new Error(`${full} is not on the list`);
  return r.id;
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await seedDemo(pg.db, seedDeps, { agency: "northside.example", today });
  jane = await personId("Jane Doe");
  await pg.db.insert(clients).values([
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "beta", name: "Beta Search", database: "wren_client_beta" },
  ]);
  await addMember(pg.db, "acme", "owner@acme.example");
  api = portalApi({ main: pg.db, open: () => pg.db });
});
afterAll(() => pg.stop());

const demo = { viewer: { demo: true as const } };
const operator = { viewer: { email: "william@wren.example", operator: true } };
const owner = { viewer: { email: "owner@acme.example" } };
const PERSON = "reactivation.person";

/** Resolves, or refuses with a PortalRefusal: never a raw error. */
const clean = async (p: Promise<unknown>) => {
  try {
    await p;
    return "answered";
  } catch (err) {
    if (err instanceof PortalRefusal) return "refused";
    const cause = (err as { cause?: unknown }).cause;
    return `raw error: ${String(cause ?? err).slice(0, 90)}`;
  }
};

describe("who sees which client", () => {
  it("the demo viewer can't name a real client", async () => {
    await expect(api.overview({ ...demo, client: "acme" })).rejects.toBeInstanceOf(PortalRefusal);
    await expect(
      api.recordsList({ ...demo, client: "beta", record: PERSON }),
    ).rejects.toBeInstanceOf(PortalRefusal);
  });

  it("a login can't reach another client, or the demo, by id", async () => {
    for (const client of ["beta", "demo", "ACME", " acme"])
      await expect(api.recordsList({ ...owner, client, record: PERSON })).rejects.toBeInstanceOf(
        PortalRefusal,
      );
    expect((await me(owner)).clients.map((c) => c.id)).toEqual(["acme"]);
  });

  it("a person on the database but not on the list is 404", async () => {
    const [p] = await pg.db.execute<{ id: number }>(
      sql`insert into people (company_id, full_name, first_name, last_name, is_compliance, origin, origin_ref, raw)
        select company_id, 'Off List', 'Off', 'List', is_compliance, origin, origin_ref || ':off', raw from people where id = ${jane} returning id`,
    );
    await expect(api.person({ ...owner, personId: p?.id ?? 0 })).rejects.toBeInstanceOf(
      PortalRefusal,
    );
  });

  it("a personId sent as a numeric string still reads", async () => {
    const view = await api.person({ ...owner, personId: String(jane) as unknown as number });
    expect(view.row.name).toBe("Jane Doe");
  });

  // Was a bug: an address pasted with a space was stored as is; that login never got in.
  it("a member added with stray spaces still signs in", async () => {
    await addMember(pg.db, "beta", " Boss@Beta.example ");
    expect((await me({ viewer: { email: "boss@beta.example" } })).clients).toEqual([
      {
        id: "beta",
        name: "Beta Search",
        installed: [],
        role: "member",
        can: ["read", "act"],
        flags: {},
      },
    ]);
  });
});

describe("inputs", () => {
  it("% and _ in the search are literal", async () => {
    for (const q of ["%", "_", "\\"])
      expect(
        (await api.recordsList({ ...operator, client: "acme", record: PERSON, q })).total,
      ).toBe(0);
  });

  // Was a bug: a non-numeric offset reaches Postgres as NaN; the raw error is retried by Restate forever.
  it("a non-numeric offset", async () => {
    expect({
      emails: await clean(api.emails({ ...demo, offset: "x" as unknown as number })),
    }).toEqual({ emails: "answered" });
  });

  // Was a bug: an offset past bigint (1e20, or 1e999 which JSON parses to Infinity) errors in Postgres, then retries forever.
  it("an offset too large for Postgres", async () => {
    expect({
      big: await clean(api.emails({ ...demo, offset: 1e20 })),
      infinity: await clean(api.emails({ ...demo, offset: Number.POSITIVE_INFINITY })),
    }).toEqual({ big: "answered", infinity: "answered" });
  });

  // Was a bug: a missing, non-numeric or fractional personId is a Postgres error, not a 404.
  it("a bad personId is a 404", async () => {
    const got: Record<string, string> = {};
    for (const personId of [undefined, "abc", 1.5, null])
      got[String(personId)] = await clean(
        api.person({ ...demo, personId: personId as unknown as number }),
      );
    expect(got).toEqual({
      undefined: "refused",
      abc: "refused",
      "1.5": "refused",
      null: "refused",
    });
  });

  it("a non-string filter on emails", async () => {
    expect(await clean(api.emails({ ...demo, filter: { a: 1 } as never }))).toBe("answered");
  });
});
