/**
 * Defaults as files (designs/2026-10-07-templates-live-copy.md, defaults tree): the loader reads a
 * tree, `sync` writes a changed file once as a `default` version and a following template goes
 * live with it, an edited one keeps its words, `install` takes what a part names, and a prompt
 * seeds from its file. Every tree here is a temporary one with synthetic words.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  covers,
  installDefaults,
  livePrompt,
  loadDefaults,
  syncDefaults,
} from "../../src/template-defaults.js";
import {
  emailRef,
  ensureTemplate,
  promptRef,
  publish,
  renderPrompt,
  resolveTemplate,
  saveDraft,
  saveLive,
  templateState,
} from "../../src/templates.js";

let pg: TestPostgres;
let dir: string;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["templates", "template_versions"]);
  dir = mkdtempSync(join(tmpdir(), "defaults-"));
  process.env.WREN_TEMPLATE_DEFAULTS = dir;
});
afterEach(() => {
  delete process.env.WREN_TEMPLATE_DEFAULTS;
  rmSync(dir, { recursive: true, force: true });
});

const put = (rel: string, words: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), words);
};
const OPENER = emailRef("demo", "arm/opener");
const W1 = "## a comment for whoever edits it\nSubject: Hi {first_name}\n\nFirst words.";
const W2 = "Subject: Hi {first_name}\n\nSecond words.";

describe("loadDefaults", () => {
  it("reads every kind by its extension, names by path, and skips what is not a template", () => {
    put("email/demo/arm/opener.email", `${W1}\n`);
    put("email/demo/README.md", "# notes");
    put("sms/texts/demo-seq#1.sms", "Hi {first_name}. Reply STOP to stop.");
    put("prompt/demo/ask.prompt", "Ask {who}.\n\n");
    const files = loadDefaults(dir);
    expect(files.map((f) => `${f.ref.kind}:${f.ref.system}/${f.ref.name}`)).toEqual([
      "email:demo/arm/opener",
      "sms:texts/demo-seq#1",
      "prompt:demo/ask",
    ]);
    // One last newline is the file's, not the words'.
    expect(files[0]?.source).toBe(W1);
    expect(files[2]?.source).toBe("Ask {who}.\n");
    expect(files[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a broken file before anything is written", () => {
    put("email/demo/bad.email", "Subject: Hi {first_name\n\nBody");
    expect(() => loadDefaults(dir)).toThrow();
  });

  it("reads the repo's own tree", () => {
    delete process.env.WREN_TEMPLATE_DEFAULTS;
    const refs = loadDefaults().map((f) => `${f.ref.kind}:${f.ref.system}/${f.ref.name}`);
    expect(refs).toContain("prompt:reactivation/compose");
    expect(refs).toContain("prompt:content/draft-ask");
    expect(refs).toContain("prompt:content/video-ask");
    expect(refs.filter((r) => r.startsWith("email:")).length).toBeGreaterThan(0);
  });
});

describe("syncDefaults", () => {
  it("writes a file once, moves a following template with it, and leaves an edit alone", async () => {
    put("email/demo/arm/opener.email", W1);
    expect(await syncDefaults(pg.db, { only: "all" })).toEqual({ files: 1, written: 1, live: 1 });
    expect(await syncDefaults(pg.db, { only: "all" })).toEqual({ files: 1, written: 0, live: 0 });
    let s = await templateState(pg.db, OPENER);
    expect(s?.status).toBe("default");
    expect(s?.folder).toBe("demo/arm");
    expect(s?.live?.origin).toBe("default");

    put("email/demo/arm/opener.email", W2);
    expect(await syncDefaults(pg.db, { only: "all" })).toEqual({ files: 1, written: 1, live: 1 });
    expect((await resolveTemplate(pg.db, OPENER))?.source).toBe(W2);

    await saveLive(pg.db, OPENER, "Subject: Mine\n\nMy words.", { by: "ann" });
    put("email/demo/arm/opener.email", W1);
    expect(await syncDefaults(pg.db, { only: "all" })).toEqual({ files: 1, written: 1, live: 0 });
    s = await templateState(pg.db, OPENER);
    expect(s?.status).toBe("updated");
    expect(s?.live?.source).toBe("Subject: Mine\n\nMy words.");
  });

  it("a client's database takes only the templates it has", async () => {
    put("email/demo/arm/opener.email", W1);
    put("prompt/demo/ask.prompt", "Ask {who}.");
    expect(await syncDefaults(pg.db, { only: "present" })).toEqual({
      files: 0,
      written: 0,
      live: 0,
    });
    await ensureTemplate(pg.db, promptRef("demo", "ask"), { followsDefault: true });
    expect(await syncDefaults(pg.db, { only: "present" })).toEqual({
      files: 1,
      written: 1,
      live: 1,
    });
    expect(await resolveTemplate(pg.db, OPENER)).toBeNull();
  });
});

describe("installDefaults", () => {
  it("takes what a part names, by ref or by folder, following the default", async () => {
    put("email/demo/arm/opener.email", W1);
    put("email/demo/arm/followup.email", W2);
    put("email/other/opener.email", W2);
    put("prompt/demo/ask.prompt", "Ask {who}.");
    expect(covers("email:demo/", OPENER)).toBe(true);
    expect(covers("email:demo/arm/opener", OPENER)).toBe(true);
    expect(covers("email:demo/arm/open", OPENER)).toBe(false);
    const out = await installDefaults(pg.db, ["email:demo/", "prompt:demo/ask"], { by: "op" });
    expect(out.templates).toEqual([
      "email:demo/arm/followup",
      "email:demo/arm/opener",
      "prompt:demo/ask",
    ]);
    expect(out.live).toBe(3);
    expect((await templateState(pg.db, OPENER))?.followsDefault).toBe(true);
    expect(await resolveTemplate(pg.db, emailRef("other", "opener"))).toBeNull();
  });
});

describe("livePrompt", () => {
  const REF = { system: "demo", name: "ask" };
  it("seeds the file's words once, then the store's words win", async () => {
    put("prompt/demo/ask.prompt", "  Ask {who} about {{x}.\n\n");
    const first = await livePrompt(pg.db, REF);
    expect(renderPrompt(first, { who: "Dana" })).toBe("  Ask Dana about {x}.\n");
    expect((await livePrompt(pg.db, REF)).version).toBe(first.version);

    await saveDraft(pg.db, promptRef(REF.system, REF.name), "Ask {who} briefly.", { by: "op" });
    expect((await livePrompt(pg.db, REF)).version).toBe(first.version);
    await publish(pg.db, promptRef(REF.system, REF.name), { by: "op" });
    expect(renderPrompt(await livePrompt(pg.db, REF), { who: "Dana" })).toBe("Ask Dana briefly.");
  });
});

describe("the legacy drop (0142)", () => {
  it("copies text and DM rows the store lacks, live where nothing is, and counts them", async () => {
    const file = new URL("../../../db/drizzle/0142_templates_legacy_drop.sql", import.meta.url);
    const copy = readFileSync(file, "utf8").split("--> statement-breakpoint")[0] as string;
    for (const t of ["sms_templates", "reach_templates"])
      await pg.db.execute(
        sql.raw(`CREATE TABLE ${t} (key varchar(120) PRIMARY KEY, body text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar(200) NOT NULL)`),
      );
    const kept = { kind: "sms", system: "texts", name: "keyword.help" } as const;
    await saveLive(pg.db, kept, "Help words for the demo line.", { by: "ann" });
    await pg.db.execute(sql`INSERT INTO sms_templates VALUES
      ('keyword.help', 'Help words for the demo line.', now(), 'ann'),
      ('demo-seq#1', 'Hi {first_name}. Reply STOP to stop.', '2026-01-02', 'bob')`);
    await pg.db.execute(sql`INSERT INTO reach_templates VALUES
      ('linkedin:connect-note', 'Hi {first_name}, glad to connect.', now(), 'cli')`);
    await pg.db.execute(sql.raw(copy));
    await pg.db.execute(sql.raw(copy));

    const text = await templateState(pg.db, { kind: "sms", system: "texts", name: "demo-seq#1" });
    expect(text?.live?.origin).toBe("import");
    expect(text?.live?.by).toBe("bob");
    expect(text?.folder).toBe("texts");
    const dm = await resolveTemplate(pg.db, {
      kind: "dm",
      system: "reach",
      name: "linkedin:connect-note",
    });
    expect(dm?.source).toBe("Hi {first_name}, glad to connect.");
    expect((await templateState(pg.db, kept))?.live?.number).toBe(1);
    for (const t of ["sms_templates", "reach_templates"])
      await pg.db.execute(sql.raw(`DROP TABLE ${t}`));
  });
});
