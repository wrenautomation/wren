/**
 * Scoped access on records and routes (designs/2026-10-06-scoped-access.md, phase 2): a YouTube
 * editor edits YouTube rows and reads the rest, a read-only LinkedIn view lists LinkedIn rows
 * only, a grant that ends drops out, a one-use grant can't be used twice, and nobody hands out
 * more than they hold. Synthetic rows and people only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { type Target, WREN } from "../../src/access.js";
import { addClient, addMember, addOperator, grants, setTeamSeat } from "../../src/clients/index.js";
import { type CallRequest, consoleApi, type HandlerRow } from "../../src/console.js";
import { addGrant, saveRole } from "../../src/grants.js";
import { guard, PortalRefusal, type PortalRequest, whoIs } from "../../src/portal.js";
import { defineRecord, status, text } from "../../src/records.js";

let pg: TestPostgres;
const ADMIN = "ada@example.test";
const EDITOR = "yuri@example.test";
const LI = "lin@example.test";
const OWNER = "owen@acme.test";

const neutral = (label: string) => ({ label, tone: "neutral" as const });
const post = defineRecord({
  id: "test.post",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "post", many: "posts" },
  view: "sa_posts",
  key: "id",
  title: "title",
  fields: {
    title: text(),
    platform: status({
      youtube: neutral("YouTube"),
      linkedin: neutral("LinkedIn"),
      x: neutral("X"),
    }),
  },
  views: [{ id: "all", label: "All" }],
  calls: { "ContentDesk/approve": "ids" },
  edits: {
    fields: ["title"],
    patch: z
      .object({ title: z.string().max(80) })
      .partial()
      .strict(),
    read: async (db, id) => {
      const [r] = (await db.execute(sql`select title from sa_posts where id = ${id}`)) as never as {
        title: string;
      }[];
      return r ? { title: r.title } : null;
    },
    write: async (db, id, patch) => {
      await db.execute(sql`update sa_posts set title = ${patch.title as string} where id = ${id}`);
    },
  },
});
const clip = defineRecord({
  id: "test.clip",
  app: "marketing",
  channel: "youtube",
  name: { one: "clip", many: "clips" },
  rows: async () => [{ id: "c1", title: "A clip" }],
  key: "id",
  title: "title",
  fields: { title: text() },
  views: [{ id: "all", label: "All" }],
});
const note = defineRecord({
  id: "test.note",
  app: "marketing",
  channel: null,
  name: { one: "note", many: "notes" },
  rows: async () => [{ id: "n1", title: "A note" }],
  key: "id",
  title: "title",
  fields: { title: text() },
  views: [{ id: "all", label: "All" }],
});
const api = () => consoleApi({ main: pg.db, views: [], records: [post, clip, note] });

/** A request as the guard hands it on: the login read fresh, grants and all. */
const as = <R extends object>(email: string, need: `wren:${string}` = "wren:read", more?: R) =>
  guard(pg.db, need as never, { viewer: { email }, ...(more ?? {}) } as PortalRequest & R, "wren");
const refused = async (p: Promise<unknown>, status: number, words?: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
  if (words) expect((err as Error).message).toContain(words);
};
const ids = (rows: { id: string | number }[]) => rows.map((r) => String(r.id)).sort();
const approve: HandlerRow = {
  service: "ContentDesk",
  handler: "approve",
  kind: "object",
  public: true,
  effect: null,
  form: false,
  viewer: false,
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create table sa_posts (id text primary key, platform text, title text)`);
  await pg.db.execute(sql`insert into sa_posts values
    ('y1', 'youtube', 'First cut'), ('y2', 'youtube', 'Second cut'),
    ('l1', 'linkedin', 'A short post'), ('x1', 'x', 'A thread')`);
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme" });
  await addOperator(pg.db, ADMIN);
  await addMember(pg.db, "acme", OWNER, { role: "owner" });
  const admin = await whoIs(pg.db, { email: ADMIN });
  const editor = await saveRole(pg.db, admin, ADMIN, {
    client: WREN,
    name: "YouTube editor",
    grants: [
      { verbs: ["read", "act", "comment"], apps: ["marketing"], channels: ["youtube"] },
      { verbs: ["read", "comment"], apps: ["marketing", "outbound"] },
    ],
  });
  const viewer = await saveRole(pg.db, admin, ADMIN, {
    client: WREN,
    name: "LinkedIn view",
    grants: [{ verbs: ["read"], apps: ["marketing"], channels: ["linkedin"] }],
  });
  await setTeamSeat(pg.db, EDITOR, { role: editor.id, clients: [WREN] });
  await setTeamSeat(pg.db, LI, { role: viewer.id, clients: [WREN] });
});
afterAll(() => pg?.stop());

describe("the YouTube editor", () => {
  it("reads every channel's rows in Marketing", async () => {
    const req = await as(EDITOR);
    const page = await api().recordsList({ ...req, record: "test.post" });
    expect(ids(page.rows)).toEqual(["l1", "x1", "y1", "y2"]);
    const types = (await api().recordsTypes(req)).map((t) => t.id);
    expect(types).toEqual(expect.arrayContaining(["test.post", "test.clip", "test.note"]));
  });

  it("edits a YouTube row, not a LinkedIn one", async () => {
    const req = await as(EDITOR, "wren:act");
    const edit = (id: string, title: string) =>
      api().recordsEdit({ ...req, record: "test.post", id, patch: { title } });
    expect((await edit("y1", "First cut, tighter")).values.title).toBe("First cut, tighter");
    await refused(edit("l1", "Not his"), 403, "changing these needs run");
  });

  it("calls a draft's handler on his own channel's row only", async () => {
    const req = await as(EDITOR, "wren:act");
    const call = (id: string, input: unknown, h = approve) =>
      api().callOn(
        { ...req, service: h.service, handler: h.handler, input, on: { record: "test.post", id } },
        h,
      );
    await expect(call("y2", { ids: ["y2"] })).resolves.toBeUndefined();
    await refused(call("l1", { ids: ["l1"] }), 403);
    // The input must name the row the check was made on.
    await refused(call("y2", { ids: ["l1"] }), 400, "isn't about this row");
    // A handler the type doesn't declare is never his.
    await refused(call("y2", { ids: ["y2"] }, { ...approve, handler: "publishAll" }), 403);
    // And with no row named, nothing.
    await refused(
      api().callOn({ ...req, service: "ContentDesk", handler: "approve" } as CallRequest, approve),
      403,
    );
  });

  it("is refused at the route for another channel, or an app outside his role", async () => {
    await expect(as(EDITOR, "wren:act", { input: { platform: "youtube" } })).resolves.toBeTruthy();
    await refused(as(EDITOR, "wren:act", { input: { platform: "linkedin" } }), 403);
    await refused(as(EDITOR, "wren:act", { platforms: ["youtube", "x"] }), 403);
    const at = (place: Target) =>
      guard(pg.db, "wren:read", { viewer: { email: EDITOR } }, "wren", place);
    await expect(at({ app: "outbound" })).resolves.toBeTruthy();
    await refused(at({ app: "money" }), 403, "no access");
  });
});

describe("a read-only LinkedIn view", () => {
  it("lists LinkedIn rows only, and the counts agree", async () => {
    const req = await as(LI);
    const page = await api().recordsList({ ...req, record: "test.post", facets: true });
    expect(ids(page.rows)).toEqual(["l1"]);
    expect(page.total).toBe(1);
    expect(page.facets?.platform).toEqual({ youtube: 0, linkedin: 1, x: 0 });
  });

  it("can't open another channel's row, or a type with none of its rows", async () => {
    const req = await as(LI);
    await refused(api().recordsGet({ ...req, record: "test.post", id: "y1" }), 404);
    expect((await api().recordsGet({ ...req, record: "test.post", id: "l1" })).row.title).toBe(
      "A short post",
    );
    const types = (await api().recordsTypes(req)).map((t) => t.id);
    expect(types).toContain("test.post");
    expect(types).not.toContain("test.clip");
    expect(types).not.toContain("test.note");
    await refused(api().recordsList({ ...req, record: "test.clip" }), 404);
  });

  it("edits nothing", async () => {
    await refused(as(LI, "wren:act"), 403, "your role can't do that");
  });
});

describe("a grant that ends", () => {
  it("shows YouTube rows until its time, then not", async () => {
    const admin = await whoIs(pg.db, { email: ADMIN });
    const { id } = await addGrant(pg.db, admin, ADMIN, {
      email: LI,
      client: WREN,
      verbs: ["read"],
      apps: ["marketing"],
      channels: ["youtube"],
      until: new Date(Date.now() + 60_000).toISOString(),
      reason: "covering this week",
    });
    const list = async () =>
      ids((await api().recordsList({ ...(await as(LI)), record: "test.post" })).rows);
    expect(await list()).toEqual(["l1", "y1", "y2"]);
    await pg.db
      .update(grants)
      .set({ until: new Date(Date.now() - 1000) })
      .where(eq(grants.id, id));
    expect(await list()).toEqual(["l1"]);
  });
});

describe("a one-use grant", () => {
  it("edits its one row once; a second use is refused", async () => {
    const admin = await whoIs(pg.db, { email: ADMIN });
    await addGrant(pg.db, admin, ADMIN, {
      email: LI,
      client: WREN,
      verbs: ["act"],
      apps: ["marketing"],
      record: "test.post:l1",
      usesLeft: 1,
    });
    // Two tabs read the login before either saves.
    const one = await as(LI, "wren:act");
    const two = await as(LI, "wren:act");
    const edit = (req: PortalRequest, title: string) =>
      api().recordsEdit({ ...req, record: "test.post", id: "l1", patch: { title } });
    await refused(
      api().recordsEdit({ ...one, record: "test.post", id: "x1", patch: { title: "No" } }),
      403,
    );
    expect((await edit(one, "Once")).values.title).toBe("Once");
    await refused(edit(two, "Twice"), 403, "that grant is used up");
    // Read fresh, it's gone.
    await refused(as(LI, "wren:act"), 403);
    const [row] = await pg.db.execute<{ title: string }>(
      sql`select title from sa_posts where id = 'l1'`,
    );
    expect(row?.title).toBe("Once");
  });
});

describe("handing out", () => {
  it("refuses a grant above the granter's own", async () => {
    const editor = await whoIs(pg.db, { email: EDITOR });
    await refused(
      addGrant(pg.db, editor, EDITOR, {
        email: LI,
        client: WREN,
        verbs: ["read"],
        apps: ["marketing"],
      }),
      403,
      "you don't manage that",
    );
    const admin = await whoIs(pg.db, { email: ADMIN });
    await refused(
      addGrant(pg.db, admin, ADMIN, { email: EDITOR, client: WREN, verbs: ["money"] }),
      403,
      "stay with admins",
    );
    const owner = await whoIs(pg.db, { email: OWNER }, "acme");
    await refused(
      addGrant(pg.db, owner, OWNER, { email: OWNER, client: "acme", verbs: ["run"] }),
      403,
      "you can't run there yourself",
    );
  });
});
