/**
 * TemplatesConsole on Restate and Postgres: a save is checked against the version opened,
 * publishing copy that sends waits on a person's yes, a prompt goes live at once, and each
 * write is checked at the template's own app and channel.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { grants } from "../../src/clients/schema.js";
import { saveLive, writeDefault } from "../../src/templates.js";
import { approvalId, makeTemplatesConsole, templateAt } from "../../src/templates-console.js";
import { startTestRestate } from "../../src/testing.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({ services: [makeTemplatesConsole({ db: pg.db })] });
  await pg.db.execute(sql`
    INSERT INTO operators (email, role) VALUES ('admin@example.test', 'admin'),
      ('viewer@example.test', 'viewer'), ('mail@example.test', 'viewer')`);
  // A viewer who may act on Outbound's email only.
  await pg.db.insert(grants).values({
    email: "mail@example.test",
    client: "wren",
    verbs: ["act"],
    apps: ["outbound"],
    channels: ["email"],
    by: "admin@example.test",
  });
}, 240_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(() => truncate(pg.db, ["templates", "template_versions"]));

type Call = (ctx: unknown, req: Record<string, unknown>) => Promise<Record<string, unknown>>;
const svc = () =>
  clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() })).serviceClient<{
    list: Call;
    detail: Call;
    preview: Call;
    save: Call;
    publish: Call;
    approve: Call;
    decline: Call;
    restore: Call;
    reset: Call;
  }>({ name: "TemplatesConsole" });

const ADMIN = { email: "admin@example.test", operator: true };
const VIEWER = { email: "viewer@example.test", operator: true };
const MAIL = { email: "mail@example.test", operator: true };
const EMAIL = { kind: "email" as const, system: "demo", name: "plain/opener" };
const REF = "email:demo/plain/opener";
const W1 = "Subject: Hi {first_name}\n\nHello {first_name}.";
const W2 = "Subject: Hey {first_name}\n\nHello again {first_name}.";

describe("TemplatesConsole", () => {
  it("maps each kind to its app and channel", () => {
    expect(templateAt({ kind: "email", system: "x" })).toMatchObject({
      app: "outbound",
      channel: "email",
    });
    expect(templateAt({ kind: "sms", system: "texts" })).toMatchObject({
      app: "texts",
      channel: "sms",
    });
    expect(templateAt({ kind: "prompt", system: "reactivation" })).toMatchObject({
      app: "reactivation",
    });
  });

  it("saves against the version opened, waits on a yes for email, and goes live on approve", async () => {
    await writeDefault(pg.db, EMAIL, W1, { hash: "1".repeat(64) });
    const saved = await svc().save({
      viewer: ADMIN,
      ref: REF,
      words: W2,
      why: "warmer",
      expect: 1,
    });
    expect(saved).toMatchObject({ conflict: null, saved: { draft: { number: 2 }, opened: 2 } });

    // Someone opened version 1 before that save: theirs is refused with what's there now.
    const stale = await svc().save({ viewer: ADMIN, ref: REF, words: `${W2}!`, expect: 1 });
    expect(stale).toMatchObject({ saved: null, conflict: { number: 2, source: W2 } });

    const asked = await svc().publish({ viewer: ADMIN, ref: REF, why: "warmer" });
    expect(asked).toMatchObject({ status: "waiting", waiting: { number: 2 }, live: { number: 1 } });

    const detail = await svc().detail({ viewer: ADMIN, ref: REF });
    expect(
      (detail.versions as { number: number; why: string | null }[]).map((v) => [v.number, v.why]),
    ).toEqual([
      [2, "warmer"],
      [1, null],
    ]);

    const id = approvalId(Number(asked.id), 2);
    expect(await svc().approve({ viewer: ADMIN, ids: [id] })).toEqual({ done: [id] });
    expect(await svc().detail({ viewer: ADMIN, ref: REF })).toMatchObject({
      status: "edited",
      live: { number: 2 },
      waiting: null,
    });
    // The ask is gone, so approving it again is refused.
    await expect(svc().approve({ viewer: ADMIN, ids: [id] })).rejects.toThrow(/nothing waiting/);
  });

  it("declines an ask, refuses one that moved, and publishes a prompt at once", async () => {
    await saveLive(pg.db, EMAIL, W1, { by: "admin@example.test" });
    await svc().save({ viewer: ADMIN, ref: REF, words: W2, expect: 1 });
    const asked = await svc().publish({ viewer: ADMIN, ref: REF });
    await expect(
      svc().approve({ viewer: ADMIN, ids: [approvalId(Number(asked.id), 1)] }),
    ).rejects.toThrow(/newer version/);
    expect(await svc().decline({ viewer: ADMIN, ids: [approvalId(Number(asked.id), 2)] })).toEqual({
      done: [approvalId(Number(asked.id), 2)],
    });

    const PROMPT = "prompt:demo/ask";
    await svc().save({ viewer: ADMIN, ref: PROMPT, words: "Write {n} lines.", expect: null });
    expect(await svc().publish({ viewer: ADMIN, ref: PROMPT })).toMatchObject({
      status: "edited",
      live: { number: 1 },
      waiting: null,
    });
  });

  it("checks act at the template's app and channel, and keeps texts on their pages", async () => {
    await saveLive(pg.db, EMAIL, W1, { by: "admin@example.test" });
    await expect(svc().save({ viewer: VIEWER, ref: REF, words: W2, expect: 1 })).rejects.toThrow(
      /can't do that/,
    );
    // Act on Outbound's email covers email copy, and nothing else.
    expect(await svc().save({ viewer: MAIL, ref: REF, words: W2, expect: 1 })).toMatchObject({
      saved: { draft: { number: 2 } },
    });
    await expect(
      svc().save({ viewer: MAIL, ref: "prompt:demo/ask", words: "x", expect: null }),
    ).rejects.toThrow(/can't do that/);
    await expect(
      svc().save({ viewer: ADMIN, ref: "sms:texts/demo#1", words: "Hi, reply STOP", expect: null }),
    ).rejects.toThrow(/copy pages/);
    await expect(
      svc().save({ viewer: { email: "stranger@else.example" }, ref: REF, words: W2, expect: 2 }),
    ).rejects.toThrow();
    // Everyone on the team reads; the list is what they may read.
    expect(((await svc().list({ viewer: VIEWER })).templates as unknown[]).length).toBe(1);
  });

  it("previews words for the made-up lead and says why bad words don't render", async () => {
    expect(await svc().preview({ viewer: VIEWER, ref: REF, words: W1 })).toMatchObject({
      sample: { subject: "Hi Sam", body: "Hello Sam." },
      problem: null,
    });
    expect(await svc().preview({ viewer: VIEWER, ref: REF, words: "Subject: {" })).toMatchObject({
      sample: null,
    });
  });
});
