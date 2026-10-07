/**
 * The Library's snippets on a real Postgres (`../../src/library.ts`), through the console: the
 * team adds, edits and removes them, tags become facets, a client's person can't reach them,
 * the demo changes nothing. Synthetic logins and words throughout.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, addOperator, clients, operators } from "../../src/clients/index.js";
import { consoleApi } from "../../src/console.js";
import { tagsOf } from "../../src/library.js";
import type { PortalRefusal } from "../../src/portal.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["snippets", "changes", "client_members", "operators", "clients"]);
  await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "wren_client_acme" });
  await addOperator(pg.db, "ada@example.test");
  await addOperator(pg.db, "val@example.test");
  await pg.db
    .update(operators)
    .set({ role: "viewer" })
    .where(eq(operators.email, "val@example.test"));
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
});

const api = () => consoleApi({ main: pg.db, views: [] });
const ADMIN = { email: "ada@example.test", operator: true, team: { role: "admin", clients: null } };
const VIEWER = {
  email: "val@example.test",
  operator: true,
  team: { role: "viewer", clients: null },
};
const OWNER = { email: "owen@acme.test" };
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err.status).toBe(status);
};

describe("snippets", () => {
  it("adds, lists with tags as facets, edits in place, and removes", async () => {
    const made = await api().snippetAdd({
      viewer: ADMIN as never,
      title: "Booking link",
      body: "Here's my calendar: {link}",
      tags: "Booking, follow-up, booking",
      channel: "email",
    });
    expect(made).toMatchObject({
      title: "Booking link",
      tags: ["booking", "follow-up"],
      channel: "email",
    });
    await api().snippetAdd({ viewer: ADMIN as never, title: "Away", body: "Out today." });

    expect((await api().snippets({ viewer: ADMIN as never })).map((s) => s.title)).toEqual([
      "Away",
      "Booking link",
    ]);
    // A client's workspace still reads Wren's, for the team drafting there.
    expect(await api().snippets({ viewer: ADMIN as never, client: "acme" } as never)).toHaveLength(
      2,
    );

    const types = await api().recordsTypes({ viewer: ADMIN as never });
    const meta = types.find((t) => t.id === "library.snippet");
    expect(Object.keys(meta?.fields.find((f) => f.key === "tags")?.states ?? {})).toEqual([
      "booking",
      "follow-up",
    ]);
    const page = await api().recordsList({
      viewer: ADMIN as never,
      record: "library.snippet",
      where: { tags: ["booking"] },
    } as never);
    expect(page.rows.map((r) => r.title)).toEqual(["Booking link"]);

    await api().recordsEdit({
      viewer: ADMIN as never,
      record: "library.snippet",
      id: String(made.id),
      patch: { body: "Book a time: {link}", tags: ["booking"], channel: "any" },
    } as never);
    const [after] = (await api().snippets({ viewer: ADMIN as never })).filter(
      (s) => s.id === made.id,
    );
    expect(after).toMatchObject({ body: "Book a time: {link}", tags: ["booking"], channel: "any" });

    await api().snippetRemove({ viewer: ADMIN as never, ids: [made.id] });
    expect(await api().snippets({ viewer: ADMIN as never })).toHaveLength(1);
    await refused(api().snippetRemove({ viewer: ADMIN as never, ids: [made.id] }), 404);
  });

  it("keeps them the team's: a viewer reads, a client's person and the demo change nothing", async () => {
    await refused(api().snippetAdd({ viewer: VIEWER as never, title: "x", body: "y" }), 403);
    await refused(api().snippets({ viewer: OWNER as never, client: "acme" } as never), 403);
    await refused(
      api().snippetAdd({ viewer: { demo: true } as never, title: "x", body: "y" }),
      403,
    );
    await refused(api().snippetAdd({ viewer: ADMIN as never, title: " ", body: "y" }), 400);
    expect(await api().snippets({ viewer: VIEWER as never })).toEqual([]);
  });
});

describe("tagsOf", () => {
  it("trims, lowercases, drops commas and repeats", () => {
    expect(tagsOf(" A, b ,a,, ")).toEqual(["a", "b"]);
    expect(tagsOf(["x,y", "Z"])).toEqual(["x y", "z"]);
  });
});
