/**
 * Notes on a real Postgres (designs/2026-10-07-notes.md): Yjs sync, the version timeline,
 * sharing, capture, search, backlinks, and a client's own database next to main. Synthetic
 * logins and words throughout.
 */
import { addMember, addOperator, clients, operators } from "@wren/core/clients";
import type { PortalRefusal } from "@wren/core/portal";
import { createDb, type DbHandle, migrate } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { notesApi, notesContext } from "../../src/console.js";
import {
  appendBody,
  fromB64,
  fromMarkdown,
  readBody,
  textOf,
  toB64,
  writeBody,
  writeTitle,
} from "../../src/doc.js";
import { trainingNotes } from "../../src/store.js";
import { SUGGEST_ADD } from "../../src/types.js";

let pg: TestPostgres;
let acme: DbHandle;
const TABLES = [
  "note_mentions",
  "note_comments",
  "note_updates",
  "note_versions",
  "note_links",
  "note_shares",
  "note_stars",
  "note_seen",
  "notes",
  "notes_settings",
];

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute("create database client_acme");
  acme = createDb(pg.url.replace(/\/[^/?]+(\?|$)/, "/client_acme$1"), { max: 2 });
  await migrate(acme.db);
});
afterAll(async () => {
  await acme.close();
  await pg.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "client_members", "operators", "clients"]);
  await truncate(acme.db, TABLES);
  await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "client_acme" });
  await addOperator(pg.db, "ada@example.test");
  await addOperator(pg.db, "oz@example.test");
  await pg.db
    .update(operators)
    .set({ role: "operator" })
    .where(eq(operators.email, "oz@example.test"));
  await addMember(pg.db, "acme", "owen@acme.test", { role: "owner" });
  await addMember(pg.db, "acme", "mia@acme.test", { role: "member" });
});

const api = () =>
  notesApi({
    main: pg.db,
    open: () => acme.db,
    files: {
      putUrl: async (k) => `https://put.test/${k}`,
      getUrl: async (k) => `https://get.test/${k}`,
    },
    zone: "UTC",
  });
const ADA = { email: "ada@example.test", operator: true } as never;
const OZ = { email: "oz@example.test", operator: true } as never;
const OWEN = { email: "owen@acme.test" } as never;
const MIA = { email: "mia@acme.test" } as never;
const refused = async (p: Promise<unknown>, status: number) => {
  const err = (await p.catch((e: unknown) => e)) as PortalRefusal;
  expect(err?.status).toBe(status);
};

/** A browser: a Y.Doc kept in step with the server through `sync`. */
async function browser(viewer: never, id: string, client?: string) {
  const doc = new Y.Doc();
  const opened = await api().open({ viewer, id, ...(client ? { client } : {}) });
  Y.applyUpdate(doc, fromB64(opened.state));
  let pending: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "server") pending.push(u);
  });
  return {
    doc,
    opened,
    async sync() {
      const update = pending.length ? toB64(Y.mergeUpdates(pending)) : "";
      pending = [];
      const out = await api().sync({
        viewer,
        id,
        update,
        sv: toB64(Y.encodeStateVector(doc)),
        ...(client ? { client } : {}),
      });
      Y.applyUpdate(doc, fromB64(out.update), "server");
      return out;
    },
    text: () => textOf(readBody(doc)),
  };
}

describe("a note in Wren's workspace", () => {
  it("is private to its owner until shared", async () => {
    const { id } = await api().create({
      viewer: ADA,
      title: "Pricing",
      markdown: "Raise the floor.",
    });
    expect((await api().home({ viewer: ADA })).notes.map((n) => n.name)).toEqual(["Pricing"]);
    expect((await api().home({ viewer: OZ, view: "all" })).notes).toEqual([]);
    await refused(api().open({ viewer: OZ, id }), 404);

    await api().share({ viewer: ADA, id, who: "team", role: "view" });
    const oz = await browser(OZ, id);
    expect(oz.opened.role).toBe("view");
    expect(oz.text()).toBe("Raise the floor.");
    appendBody(oz.doc, fromMarkdown("sneaky"));
    await refused(oz.sync(), 403);
    await refused(api().share({ viewer: OZ, id, who: "team", role: "edit" }), 403);
  });

  it("syncs edits both ways and keeps a timeline by session", async () => {
    const { id } = await api().create({ viewer: ADA, title: "Plan" });
    await api().share({ viewer: ADA, id, who: "oz@example.test", role: "edit" });
    const a = await browser(ADA, id);
    const o = await browser(OZ, id);

    appendBody(a.doc, fromMarkdown("Call Sam today"));
    await a.sync();
    appendBody(a.doc, fromMarkdown("then Ana"));
    await a.sync();
    let v = (await api().versions({ viewer: ADA, id })).versions;
    // Ada's edits within minutes of making it are one session.
    expect(v.map((x) => [x.number, x.authors])).toEqual([[1, ["ada@example.test"]]]);

    await o.sync();
    expect(o.text()).toBe("Call Sam today\nthen Ana");
    // Offline in two places at once: both land.
    appendBody(o.doc, fromMarkdown("Oz adds this"));
    writeTitle(a.doc, "Plan for Q4");
    await o.sync();
    const out = await a.sync();
    expect(out.title).toBe("Plan for Q4");
    expect(a.text()).toBe("Call Sam today\nthen Ana\nOz adds this");

    v = (await api().versions({ viewer: ADA, id })).versions;
    expect(v.map((x) => x.authors[0])).toEqual([
      "ada@example.test",
      "oz@example.test",
      "ada@example.test",
    ]);
    expect(v[1]?.added).toBe(3);

    // Compare credits each word to its version.
    const cmp = await api().compare({ viewer: ADA, id, from: 1, to: 3 });
    expect(cmp.pieces.filter((p) => p.op === "ins").map((p) => [p.text.trim(), p.by])).toEqual([
      ["Oz adds this", 2],
    ]);
    expect(cmp.authors[2]).toEqual(["oz@example.test"]);

    // Name one, restore it: a new version, and the browsers get it on their next sync.
    await api().nameVersion({ viewer: ADA, id, number: 1, name: "Before Oz" });
    const r = await api().restore({ viewer: ADA, id, number: 1 });
    expect(r.version).toBe(4);
    await o.sync();
    expect(o.text()).toBe("Call Sam today\nthen Ana");
    v = (await api().versions({ viewer: OZ, id })).versions;
    expect(v[0]).toMatchObject({ number: 4, kind: "restore", restoredFrom: 1 });
    expect(v.find((x) => x.number === 1)?.name).toBe("Before Oz");
    // Nothing is lost: version 3 still reads as it was.
    expect((await api().version({ viewer: OZ, id, number: 3 })).text).toContain("Oz adds this");
  });

  it("captures to the Dump note, searches, links back, stars and archives", async () => {
    const c1 = await api().capture({ viewer: ADA, words: "idea: weekly digest for clients" });
    const c2 = await api().capture({ viewer: ADA, words: "ask Sam about **pricing**" });
    expect(c1.dump && c2.dump && c1.id === c2.id).toBe(true);
    const dump = await api().open({ viewer: ADA, id: c1.id });
    expect(dump.kind).toBe("dump");
    expect(dump.name).toBe("Dump");

    const { id } = await api().create({ viewer: ADA, markdown: "Acme kickoff notes" });
    const b = await browser(ADA, id);
    b.doc.transact(() => {
      appendBody(b.doc, {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "see " },
              { type: "mention", attrs: { id: "console.client:acme", label: "Acme" } },
            ],
          },
        ],
      });
    });
    await b.sync();
    expect(
      (await api().backlinks({ viewer: ADA, target: "console.client:acme" })).notes.map(
        (n) => n.id,
      ),
    ).toEqual([id]);
    expect((await api().backlinks({ viewer: OZ, target: "console.client:acme" })).notes).toEqual(
      [],
    );

    const found = await api().home({ viewer: ADA, view: "all", q: "digest" });
    expect(found.notes.map((n) => n.id)).toEqual([c1.id]);
    expect(found.notes[0]?.excerpt).toContain("«digest»");

    await api().star({ viewer: ADA, id, on: true });
    expect((await api().home({ viewer: ADA, view: "starred" })).notes.map((n) => n.id)).toEqual([
      id,
    ]);
    await api().archive({ viewer: ADA, id, on: true });
    expect((await api().home({ viewer: ADA, view: "all" })).notes.map((n) => n.id)).toEqual([
      c1.id,
    ]);
    expect((await api().home({ viewer: ADA, view: "archived" })).notes.map((n) => n.id)).toEqual([
      id,
    ]);

    // Ask Claude's context: notes this asker may open, never another's private ones.
    expect(
      await notesContext({ main: pg.db, open: () => acme.db }, { viewer: ADA }, "weekly digest?"),
    ).toContain(`/notes/doc/${c1.id}`);
    expect(
      await notesContext({ main: pg.db, open: () => acme.db }, { viewer: OZ }, "weekly digest?"),
    ).toBe("");
  });

  it("view as never shows private notes; the demo writes nothing", async () => {
    const { id } = await api().create({ viewer: ADA, markdown: "mine" });
    await refused(api().open({ viewer: ADA, viewAs: "oz@example.test", id } as never), 404);
    await refused(api().create({ viewer: { demo: true } as never, markdown: "x" }), 403);
  });

  it("images go up per note", async () => {
    const { id } = await api().create({ viewer: ADA, markdown: "x" });
    const up = await api().upload({
      viewer: ADA,
      id,
      name: "shot 1.png",
      type: "image/png",
      size: 10,
    });
    expect(up.key).toMatch(new RegExp(`^notes/wren/${id}/[0-9a-f]{8}-shot-1\\.png$`));
    expect((await api().file({ viewer: ADA, id, key: up.key })).url).toBe(
      `https://get.test/${up.key}`,
    );
    await refused(api().file({ viewer: ADA, id, key: "notes/wren/other/x.png" }), 404);
    await refused(
      api().upload({ viewer: ADA, id, name: "a.pdf", type: "application/pdf", size: 10 }),
      400,
    );
  });
});

describe("comments, suggestions and mentions", () => {
  const ANCHOR = {
    from: { item: { client: 1, clock: 0 }, assoc: 0 },
    to: { item: null, assoc: -1 },
  };

  it("threads comments on a range, tells whoever is @ed, and opening the note marks it seen", async () => {
    const { id } = await api().create({ viewer: ADA, title: "Launch", markdown: "Ship Friday." });
    await api().share({ viewer: ADA, id, who: "oz@example.test", role: "comment" });

    const t = await api().comment({
      viewer: ADA,
      id,
      body: "@oz@example.test can you check the date?",
      anchor: ANCHOR,
      quote: "Friday",
    });
    expect(t).toMatchObject({ quote: "Friday", mentions: ["oz@example.test"] });
    // A thread needs its words; a reply doesn't.
    await refused(api().comment({ viewer: ADA, id, body: "no range" }), 400);

    let m = await api().mentions({ viewer: OZ });
    expect(m.unseen).toBe(1);
    expect(m.mentions[0]).toMatchObject({ noteId: id, name: "Launch", commentId: t.id });

    await api().comment({ viewer: OZ, id, body: "Friday works.", parentId: t.id });
    await api().resolve({ viewer: OZ, id, commentId: t.id });
    const c = await api().comments({ viewer: ADA, id });
    expect(c.threads).toHaveLength(1);
    expect(c.threads[0]?.replies.map((r) => r.body)).toEqual(["Friday works."]);
    expect(c.threads[0]?.resolvedBy).toBe("oz@example.test");
    // Only its author changes the words.
    await refused(api().commentEdit({ viewer: OZ, id, commentId: t.id, body: "mine now" }), 403);

    await api().open({ viewer: OZ, id });
    m = await api().mentions({ viewer: OZ });
    expect(m.unseen).toBe(0);
    expect(m.mentions[0]?.seen).toBe(true);
  });

  it("a mention never shares: it shows once the note is shared", async () => {
    const { id } = await api().create({ viewer: ADA, title: "Private" });
    await api().share({ viewer: ADA, id, who: "team", role: "comment" });
    await api().comment({ viewer: ADA, id, body: "for @oz@example.test", anchor: ANCHOR });
    await api().share({ viewer: ADA, id, who: "team", role: null });
    expect((await api().mentions({ viewer: OZ })).unseen).toBe(0);
    await api().share({ viewer: ADA, id, who: "oz@example.test", role: "view" });
    expect((await api().mentions({ viewer: OZ })).unseen).toBe(1);
  });

  it("a commenter's change goes in only as their own suggestion", async () => {
    const { id } = await api().create({ viewer: ADA, title: "Copy", markdown: "Hello there." });
    await api().share({ viewer: ADA, id, who: "oz@example.test", role: "comment" });
    const o = await browser(OZ, id);
    expect(o.opened.role).toBe("comment");

    // A plain edit is refused.
    appendBody(o.doc, fromMarkdown("sneaky"));
    await refused(o.sync(), 403);

    // Their suggestion is taken, and the owner sees it marked.
    const o2 = await browser(OZ, id);
    const body = readBody(o2.doc);
    const para = body.content?.[0];
    para?.content?.push({
      type: "text",
      text: " Welcome!",
      marks: [{ type: SUGGEST_ADD, attrs: { by: "oz@example.test", at: "2026-10-07T10:00" } }],
    });
    writeBody(o2.doc, body);
    expect((await o2.sync()).role).toBe("comment");
    const a = await browser(ADA, id);
    expect(a.text()).toBe("Hello there. Welcome!");
    const marks = readBody(a.doc).content?.[0]?.content?.[1]?.marks;
    expect(marks?.[0]).toMatchObject({ type: SUGGEST_ADD, attrs: { by: "oz@example.test" } });

    // Someone else's suggestion isn't theirs to suggest.
    const o3 = await browser(OZ, id);
    const forged = readBody(o3.doc);
    forged.content?.[0]?.content?.push({
      type: "text",
      text: " Forged.",
      marks: [{ type: SUGGEST_ADD, attrs: { by: "ada@example.test", at: "2026-10-07T10:00" } }],
    });
    writeBody(o3.doc, forged);
    await refused(o3.sync(), 403);
  });
});

describe("a client's workspace", () => {
  it("keeps its notes in its own database, shared by the workspace's access", async () => {
    const { id } = await api().create({
      viewer: OWEN,
      client: "acme",
      markdown: "Our offsite",
    } as never);
    const [row] = await acme.db.execute(`select count(*)::int as n from notes`);
    expect(row?.n).toBe(1);
    expect((await pg.db.execute(`select count(*)::int as n from notes`))[0]?.n).toBe(0);

    await refused(api().open({ viewer: MIA, client: "acme", id } as never), 404);
    await api().general({
      viewer: OWEN,
      client: "acme",
      id,
      general: "workspace",
      role: "comment",
    } as never);
    const mia = await api().open({ viewer: MIA, client: "acme", id } as never);
    expect(mia.role).toBe("comment");
    // Wren's team working the client is in its workspace too.
    expect((await api().open({ viewer: ADA, client: "acme", id } as never)).role).toBe("comment");
  });

  it("reads a Wren note shared to the client from main", async () => {
    const { id } = await api().create({
      viewer: ADA,
      title: "Your Q4 plan",
      markdown: "Three steps.",
    });
    expect(
      (await api().home({ viewer: OWEN, client: "acme", view: "shared" } as never)).notes,
    ).toEqual([]);
    await refused(api().share({ viewer: ADA, id, who: "client:nope", role: "view" }), 404);
    await api().share({ viewer: ADA, id, who: "client:acme", role: "view" });
    const home = await api().home({ viewer: OWEN, client: "acme", view: "shared" } as never);
    expect(home.notes.map((n) => [n.name, n.home])).toEqual([["Your Q4 plan", "wren"]]);
    const b = await browser(OWEN, id, "acme");
    expect(b.opened.home).toBe("wren");
    expect(b.text()).toBe("Three steps.");
    appendBody(b.doc, fromMarkdown("no"));
    await refused(b.sync(), 403);
  });
});

describe("training", () => {
  it("exports only notes opted in, or every note once the workspace is", async () => {
    const a = await api().create({ viewer: ADA, markdown: "one" });
    await api().create({ viewer: ADA, markdown: "two" });
    expect(await trainingNotes(pg.db)).toEqual([]);
    await api().train({ viewer: ADA, id: a.id, on: true });
    expect((await trainingNotes(pg.db)).map((n) => n.note.text)).toEqual(["one"]);
    await api().workspaceTrain({ viewer: ADA, on: true });
    expect((await trainingNotes(pg.db)).map((n) => n.note.text)).toEqual(["one", "two"]);
  });
});
