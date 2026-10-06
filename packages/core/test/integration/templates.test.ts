/** The template store on Postgres: a save is a draft, Publish makes it live, imports never override. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { templates, templateVersions } from "../../src/schema.js";
import { AuthoringError } from "../../src/slots/parse.js";
import {
  clearTemplate,
  importVersion,
  liveTemplates,
  publish,
  saveDraft,
  saveLive,
  type TemplateRef,
  templateState,
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
    const back = await publish(pg.db, TEXT, {
      by: "op@example.com",
      version: first.draft?.version as string,
    });
    expect(back.live?.version).toBe(first.draft?.version);
    const versions = await pg.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, back.id));
    expect(versions).toHaveLength(2);
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
