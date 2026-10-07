/**
 * The template store on Postgres: a save is a numbered draft checked against the version it was
 * opened from, Publish makes it live (or asks, for copy that sends), defaults follow until a
 * template has its own copy, and every write names its actor in the audit log.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { templates, templateVersions } from "../../src/schema.js";
import { AuthoringError } from "../../src/slots/parse.js";
import {
  approve,
  askPublish,
  clearTemplate,
  decline,
  importVersion,
  liveTemplates,
  moveTemplate,
  parseRef,
  promptRef,
  publish,
  recordVersion,
  refText,
  renameFolder,
  reset,
  resolveTemplate,
  restore,
  saveDraft,
  saveLive,
  TemplateConflict,
  type TemplateRef,
  TemplateRefusal,
  templateState,
  writeDefault,
} from "../../src/templates.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["templates", "template_versions"]));

const TEXT: TemplateRef = { kind: "sms", system: "texts", name: "demo-seq#1" };
const RULES = { fields: ["first_name"], mustSayStop: true };

describe("template store", () => {
  it("keeps a save as a draft, sends nothing new until Publish, and rolls back by version", async () => {
    const first = await saveDraft(pg.db, TEXT, "Hi {first_name}, reply STOP to opt out.", {
      by: "op@example.com",
      rules: RULES,
    });
    expect(first.live).toBeNull();
    expect(first.draft?.source).toBe("Hi {first_name}, reply STOP to opt out.");
    expect((await liveTemplates(pg.db, "sms", "texts")).size).toBe(0);

    const live = await publish(pg.db, TEXT, { by: "op@example.com" });
    expect(live.draft).toBeNull();
    expect(live.live?.version).toBe(first.draft?.version);

    const second = await saveDraft(pg.db, TEXT, "Hey {first_name|there}. Text STOP to stop.", {
      by: "op@example.com",
      rules: RULES,
    });
    expect(second.live?.version).toBe(first.draft?.version);
    const read = await liveTemplates(pg.db, "sms", "texts");
    expect(read.get("demo-seq#1")?.source).toBe("Hi {first_name}, reply STOP to opt out.");

    await publish(pg.db, TEXT, { by: "op@example.com" });
    const back = await publish(pg.db, TEXT, { by: "op@example.com", number: 1 });
    expect(back.live?.version).toBe(first.draft?.version);
    const versions = await pg.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, back.id));
    expect(versions.map((v) => v.number).sort()).toEqual([1, 2]);
    expect(versions.every((v) => v.createdBy === "op@example.com")).toBe(true);
  });

  it("saving the live words again clears the draft and keeps one version", async () => {
    await saveLive(pg.db, TEXT, "Hi. Reply STOP to opt out.", { by: "op", rules: RULES });
    await saveDraft(pg.db, TEXT, "Hello. Reply STOP to opt out.", { by: "op", rules: RULES });
    const same = await saveDraft(pg.db, TEXT, "  Hi. Reply STOP to opt out. ", {
      by: "op",
      rules: RULES,
    });
    expect(same.draft).toBeNull();
    expect((await pg.db.select().from(templateVersions)).length).toBe(2);
  });

  it("refuses words that break the slot's rules", async () => {
    await expect(
      saveDraft(pg.db, TEXT, "Hi {nope}. STOP", { by: "op", rules: RULES }),
    ).rejects.toThrow(AuthoringError);
    await expect(saveDraft(pg.db, TEXT, "Hi there", { by: "op", rules: RULES })).rejects.toThrow(
      /STOP/,
    );
    expect(await templateState(pg.db, TEXT)).toBeNull();
  });

  it("imports once: live when nothing is, never over a publish, kept with its old time", async () => {
    const at = new Date("2026-01-02T03:04:05Z");
    const a = await importVersion(pg.db, TEXT, "Old words. STOP", { by: "cli", at });
    expect(a.live).toBe(true);
    expect(await importVersion(pg.db, TEXT, "Old words. STOP", { by: "cli", at })).toEqual(a);
    await saveLive(pg.db, TEXT, "New words. STOP", { by: "op" });
    const b = await importVersion(pg.db, TEXT, "Other words. STOP", { by: "cli" });
    expect(b.live).toBe(false);
    const [old] = await pg.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.version, a.version));
    expect(old?.createdAt.toISOString()).toBe(at.toISOString());
    expect(old?.publishedBy).toBe("cli");
  });

  it("an emptied slot reads as absent and keeps its versions", async () => {
    await saveLive(pg.db, TEXT, "Words. STOP", { by: "op" });
    await clearTemplate(pg.db, TEXT);
    expect((await liveTemplates(pg.db, "sms", "texts")).size).toBe(0);
    expect((await pg.db.select().from(templateVersions)).length).toBe(1);
    expect((await pg.db.select().from(templates)).length).toBe(1);
  });

  it("parses each kind its own way: an email has a subject, a prompt keeps its words", async () => {
    await importVersion(
      pg.db,
      { kind: "email", system: "demo", name: "opener" },
      "Subject: Hi {first_name}\n\nHello {first_name},\n\nA line.",
      { by: "import:files" },
    );
    const prompt = 'Return JSON {{"a": 1}}.\n\n  - keep  this\n';
    await importVersion(pg.db, { kind: "prompt", system: "demo", name: "ask" }, prompt, {
      by: "import:code",
    });
    const email = (await liveTemplates(pg.db, "email", "demo")).get("opener");
    expect(email?.template.subject).not.toBeNull();
    const ask = (await liveTemplates(pg.db, "prompt", "demo")).get("ask");
    expect(ask?.source).toBe(prompt);
  });
});

const EMAIL: TemplateRef = { kind: "email", system: "demo", name: "plain/opener" };
const W1 = "Subject: Hi {first_name}\n\nHello {first_name}.";
const W2 = "Subject: Hey {first_name}\n\nHello again {first_name}.";
const W3 = "Subject: Yo {first_name}\n\nA third try.";
const hash = (n: number) => String(n).repeat(64).slice(0, 64);

describe("refs", () => {
  it("reads and writes kind:system/name, a name keeping its slashes", () => {
    const ref = parseRef("email:recruiting/book-first/opener");
    expect(ref).toEqual({ kind: "email", system: "recruiting", name: "book-first/opener" });
    expect(refText(ref)).toBe("email:recruiting/book-first/opener");
    expect(() => parseRef("fax:x/y")).toThrow(/kind one of/);
    expect(() => parseRef("email:nosystem")).toThrow();
  });
});

describe("compare and swap", () => {
  it("refuses a save opened from a version that moved, and saves on top when asked", async () => {
    const a = await saveDraft(pg.db, EMAIL, W1, { by: "ann", expect: null, why: "first" });
    expect(a.draft).toMatchObject({ number: 1 });
    await saveDraft(pg.db, EMAIL, W2, { by: "bob", expect: 1 });
    const late = saveDraft(pg.db, EMAIL, W3, { by: "ann", expect: 1 });
    await expect(late).rejects.toBeInstanceOf(TemplateConflict);
    await expect(late).rejects.toThrow("Changed since you opened it.");
    const err = await saveDraft(pg.db, EMAIL, W3, { by: "ann", expect: 1 }).catch((e) => e);
    expect((err as TemplateConflict).current).toMatchObject({ number: 2, by: "bob" });
    const top = await saveDraft(pg.db, EMAIL, W3, { by: "ann", expect: 2, why: "on top" });
    expect(top.draft).toMatchObject({ number: 3 });
    const [v3] = await pg.db.select().from(templateVersions).where(eq(templateVersions.number, 3));
    expect(v3).toMatchObject({ why: "on top", origin: "edit", createdBy: "ann" });
    const [v2] = await pg.db.select().from(templateVersions).where(eq(templateVersions.number, 2));
    expect(v3?.openedFrom).toBe(v2?.id);
  });

  it("names the actor of each write in the audit log, in the same transaction", async () => {
    const [{ top } = { top: 0 }] = (await pg.db.execute(
      sql`SELECT coalesce(max(id), 0)::float8 top FROM audit_events`,
    )) as unknown as { top: number }[];
    await saveDraft(pg.db, EMAIL, W1, { by: "ann@example.com" });
    await publish(pg.db, EMAIL, { by: "bob@example.com", why: "go" });
    const rows = (await pg.db.execute(sql`
      SELECT table_name, op, actor FROM audit_events
      WHERE id > ${top} AND table_name IN ('templates', 'template_versions') ORDER BY id`)) as unknown as {
      table_name: string;
      op: string;
      actor: string | null;
    }[];
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.filter((r) => r.table_name === "template_versions")[0]?.actor).toBe(
      "ann@example.com",
    );
    expect(rows.at(-1)?.actor).toBe("bob@example.com");
    const [t] = await pg.db.select().from(templates);
    expect(t?.why).toBe("go");
  });
});

describe("approval", () => {
  it("copy that sends waits on a yes; a prompt goes live at once", async () => {
    await saveDraft(pg.db, EMAIL, W1, { by: "agent:claude" });
    const asked = await askPublish(pg.db, EMAIL, { by: "agent:claude" });
    expect(asked).toMatchObject({ status: "waiting", waiting: { number: 1 }, live: null });
    expect(await resolveTemplate(pg.db, EMAIL)).toBeNull();
    await expect(approve(pg.db, EMAIL, { by: "ann", number: 9 })).rejects.toBeInstanceOf(
      TemplateConflict,
    );
    const yes = await approve(pg.db, EMAIL, { by: "ann", number: 1, why: "reads well" });
    expect(yes).toMatchObject({
      status: "edited",
      live: { number: 1 },
      waiting: null,
      draft: null,
    });

    await saveDraft(pg.db, EMAIL, W2, { by: "agent:claude" });
    await askPublish(pg.db, EMAIL, { by: "agent:claude" });
    const no = await decline(pg.db, EMAIL, { by: "ann" });
    expect(no).toMatchObject({ waiting: null, live: { number: 1 }, draft: { number: 2 } });
    await expect(decline(pg.db, parseRef("email:demo/none"), { by: "ann" })).rejects.toBeInstanceOf(
      TemplateRefusal,
    );

    const prompt = promptRef("demo", "ask");
    await saveDraft(pg.db, prompt, "Ask {who}.", { by: "agent:claude" });
    expect(await askPublish(pg.db, prompt, { by: "agent:claude" })).toMatchObject({
      live: { number: 1 },
      waiting: null,
    });
  });
});

describe("restore", () => {
  it("copies an old version as a new numbered draft, overwriting nothing", async () => {
    await saveLive(pg.db, EMAIL, W1, { by: "ann" });
    await saveLive(pg.db, EMAIL, W2, { by: "ann" });
    const back = await restore(pg.db, EMAIL, 1, { by: "bob", why: "the first was better" });
    expect(back.draft).toMatchObject({ number: 3, origin: "restore", source: W1 });
    expect(back.live).toMatchObject({ number: 2 });
    const live = await publish(pg.db, EMAIL, { by: "bob" });
    expect(live.live?.version).toBe((await templateState(pg.db, EMAIL))?.live?.version);
    expect(live.live).toMatchObject({ number: 3, source: W1 });
    expect(await recordVersion(pg.db, EMAIL, live.live?.version as string, { source: W1 })).toBe(
      live.live?.id,
    );
  });
});

describe("defaults", () => {
  it("a new template follows its default, and a later default goes live at once", async () => {
    const first = await writeDefault(pg.db, EMAIL, W1, { hash: hash(1) });
    expect(first).toEqual({ written: true, live: true });
    expect(await writeDefault(pg.db, EMAIL, W1, { hash: hash(1) })).toEqual({
      written: false,
      live: true,
    });
    expect((await resolveTemplate(pg.db, EMAIL))?.source).toBe(W1);
    await writeDefault(pg.db, EMAIL, W2, { hash: hash(2) });
    const s = await templateState(pg.db, EMAIL);
    expect(s).toMatchObject({ status: "default", followsDefault: true, live: { number: 2 } });
    expect(s?.folder).toBe("demo/plain");
    expect((await liveTemplates(pg.db, "email", "demo")).get("plain/opener")?.number).toBe(2);
  });

  it("own copy keeps its words when the default moves, says so, and reset follows again", async () => {
    await writeDefault(pg.db, EMAIL, W1, { hash: hash(1) });
    await saveLive(pg.db, EMAIL, W3, { by: "ann" });
    expect(await templateState(pg.db, EMAIL)).toMatchObject({ status: "edited" });
    await writeDefault(pg.db, EMAIL, W2, { hash: hash(2) });
    const s = await templateState(pg.db, EMAIL);
    expect(s).toMatchObject({ status: "updated", live: { source: W3 } });
    const r = await reset(pg.db, EMAIL, { by: "ann", why: "take Wren's" });
    expect(r).toMatchObject({ status: "default", followsDefault: true, live: { source: W2 } });
    await writeDefault(pg.db, EMAIL, W1, { hash: hash(3) });
    expect((await resolveTemplate(pg.db, EMAIL))?.source).toBe(W1);
    // Its own versions stay in history.
    const all = await pg.db.select().from(templateVersions);
    expect(all.map((v) => v.origin).sort()).toEqual(["default", "default", "default", "edit"]);
  });

  it("copy kept before defaults follows the first default only when its words are the file's", async () => {
    const other: TemplateRef = { ...EMAIL, name: "plain/other" };
    await importVersion(pg.db, EMAIL, W1, { by: "import:files" });
    await importVersion(pg.db, other, W3, { by: "import:files" });
    await writeDefault(pg.db, EMAIL, W1, { hash: hash(1) });
    await writeDefault(pg.db, other, W1, { hash: hash(1) });
    expect(await templateState(pg.db, EMAIL)).toMatchObject({ followsDefault: true });
    expect(await templateState(pg.db, other)).toMatchObject({
      followsDefault: false,
      live: { source: W3 },
    });
  });
});

describe("folders", () => {
  it("moves a template and renames a folder without touching its ref", async () => {
    await saveLive(pg.db, EMAIL, W1, { by: "ann" });
    await moveTemplate(pg.db, EMAIL, " outreach / first ", "ann");
    expect((await templateState(pg.db, EMAIL))?.folder).toBe("outreach/first");
    expect(await renameFolder(pg.db, "outreach", "cold", "ann")).toBe(1);
    expect((await templateState(pg.db, EMAIL))?.folder).toBe("cold/first");
    expect((await resolveTemplate(pg.db, EMAIL))?.source).toBe(W1);
  });
});
