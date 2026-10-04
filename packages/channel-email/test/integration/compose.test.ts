/** Compose against the migrated schema: enrollments, pinned drafts, sender pinning, provenance. */
import { randomUUID } from "node:crypto";
import { companies, leads, runs, suppressions } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseTemplate, toSource } from "../../src/outreach/authoring.js";
import { compose } from "../../src/outreach/compose.js";
import { halfOf } from "../../src/outreach/facts.js";
import { sequence, sequenceStep, twoEmailSequence } from "../../src/outreach/sequences.js";
import { field, template } from "../../src/outreach/templates.js";
import { templateVersions } from "../../src/schema.js";
import {
  addVerifiedAddress,
  allEnrollments,
  allMessages,
  FOLLOWUP,
  makeCompany,
  makeEnrollment,
  makePerson,
  messagesOf,
  OPENER,
  runCompose,
  SENDER,
  TABLES,
  TEMPLATES,
  VERIFICATION_HORIZON_DAYS,
} from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = () => pg.db;

const prov = (m: { provenance: unknown } | undefined): Record<string, unknown> =>
  (m?.provenance ?? {}) as Record<string, unknown>;

const one = async <T>(rows: Promise<T[]>): Promise<T> => {
  const list = await rows;
  expect(list).toHaveLength(1);
  return list[0] as T;
};

describe("compose", () => {
  it("creates an enrollment with pinned drafts", async () => {
    const company = await makeCompany(db());
    const person = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(1);
    expect(stats.messages_drafted).toBe(2);
    const enrollment = await one(allEnrollments(db()));
    expect(enrollment.personId).toBe(person.id);
    expect(enrollment.state).toBe("active");
    expect(enrollment.offer).toBe("test-offer");
    expect(enrollment.sequenceSnapshot).toEqual({
      name: "test-seq",
      arm: null,
      steps: [
        { template: "opener", day: 0 },
        { template: "followup", day: 3 },
      ],
    });
    const [opener, followup] = await messagesOf(db(), enrollment);
    expect(opener?.subject).toBe("Quick question, Jane");
    expect(opener?.body).toBe("Hi Jane,\n\nI build automations for advisers.");
    expect(opener?.toEmail).toBe("jane@oakbridge.example");
    expect(opener?.state).toBe("draft");
    expect(opener?.templateVersion).toBe(OPENER.version);
    expect(prov(opener).fields).toEqual(["first_name"]);
    expect(followup?.subject).toBeNull();
    expect(opener?.openToken).toBeNull();
    expect(opener?.linkCode).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("enrolls one best-ranked person per company and never re-approaches", async () => {
    const company = await makeCompany(db());
    const jane = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await makePerson(db(), company, {
      full: "Paul Partner",
      first: "Paul",
      title: "Managing Partner",
      email: "paul@oakbridge.example",
    });
    expect((await runCompose(db())).enrolled).toBe(1);
    expect((await one(allEnrollments(db()))).personId).toBe(jane.id);
    expect((await runCompose(db())).enrolled).toBe(0);
  });

  it("falls to the next person when the best has no address", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company);
    const bob = await makePerson(db(), company, {
      full: "Bob Ops",
      first: "Bob",
      title: "Managing Partner",
      email: "bob@oakbridge.example",
    });
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(1);
    expect(stats.skipped_no_address).toBe(1);
    expect((await one(allEnrollments(db()))).personId).toBe(bob.id);
  });

  it("a person whose newest lookup says they moved on is skipped; the firm falls to its next", async () => {
    const company = await makeCompany(db());
    const jane = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const bob = await makePerson(db(), company, {
      full: "Bob Ops",
      first: "Bob",
      title: "Managing Partner",
      email: "bob@oakbridge.example",
    });
    const fact = (personId: number, kind: string, confidence: number, observed: string) =>
      db().execute(sql`INSERT INTO findings (kind, person_id, fact_key, value, confidence, via, observed_at)
        VALUES (${kind}, ${personId}, ${`p${personId}:${kind}:${observed}`}, '{}'::jsonb, ${confidence}, 'test', ${observed}::timestamptz)`);
    // Jane: there once, newer read says she left. Out.
    await fact(jane.id, "still_there", 0.9, "2026-09-01T00:00:00Z");
    await fact(jane.id, "job_change", 0.8, "2026-09-20T00:00:00Z");
    // Bob: an old unsure move, a newer read says he is still there. In.
    await fact(bob.id, "left", 0.95, "2026-08-01T00:00:00Z");
    await fact(bob.id, "still_there", 0.9, "2026-09-10T00:00:00Z");
    expect((await runCompose(db())).enrolled).toBe(1);
    expect((await one(allEnrollments(db()))).personId).toBe(bob.id);
  });

  it("an unsure move never keeps a person out", async () => {
    const company = await makeCompany(db());
    const jane = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await db().execute(sql`INSERT INTO findings (kind, person_id, fact_key, value, confidence, via)
      VALUES ('job_change', ${jane.id}, 'unsure', '{}'::jsonb, 0.6, 'test')`);
    expect((await runCompose(db())).enrolled).toBe(1);
  });

  it("skips suppressed addresses", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await db()
      .insert(suppressions)
      .values({ kind: "email", value: "jane@oakbridge.example", reason: "opt_out" });
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_suppressed).toBe(1);
  });

  it("skips people whose facts cannot fill the template", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const needy = template("needy", null, [field("company.employees")]);
    const stats = await compose(db(), {
      niche: "sec_ria",
      sequence: sequence("needy-seq", [sequenceStep("needy", 0)]),
      offer: "test-offer",
      templates: new Map([["needy", needy]]),
      verificationHorizonDays: VERIFICATION_HORIZON_DAYS,
      senders: [SENDER],
      factsView: null,
    });
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_missing_facts).toBe(1);
  });

  it("where gates on the facts row the templates see", async () => {
    const marketing = await makeCompany(db(), {
      domain: "ads.example",
      name: "Ads Co",
      niche: "agencies",
      raw: { "agency.services": "60% Pay Per Click, 40% Search Engine Optimization" },
    });
    const build = await makeCompany(db(), {
      domain: "dev.example",
      name: "Dev Co",
      niche: "agencies",
      raw: { "agency.services": "70% Web Development, 30% Web Design" },
    });
    const tied = await makeCompany(db(), {
      domain: "tie.example",
      name: "Tie Co",
      niche: "agencies",
      raw: { "agency.services": "50% Pay Per Click, 50% Web Development" },
    });
    await makePerson(db(), marketing, { email: "a@ads.example" });
    await makePerson(db(), build, { email: "b@dev.example" });
    await makePerson(db(), tied, { email: "c@tie.example" });
    const stats = await runCompose(db(), {
      niche: "agencies",
      factsView: "agency_facts",
      where: { "company.segment": "marketing" },
    });
    expect(stats.enrolled).toBe(1);
    expect(stats.skipped_where).toBe(2);
    expect((await one(allEnrollments(db()))).companyId).toBe(marketing.id);
  });

  it("each draft's links carry that draft's own code, and half splits companies", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const linked = new Map([
      ["opener", parseTemplate("opener", "Hi {first_name},\n\nBook: {link.book}")],
      ["followup", parseTemplate("followup", "Read: {link.page}\n\n(({link.watch}))")],
    ]);
    const half = halfOf(company.id);
    const other = half === "a" ? "b" : "a";
    const opts = {
      templates: linked,
      site: "https://site.example",
      offerFacts: { "offer.page": "/recruiting/x" },
    };
    expect(await runCompose(db(), { ...opts, where: { half: other } })).toMatchObject({
      enrolled: 0,
      skipped_where: 1,
    });
    expect((await runCompose(db(), { ...opts, where: { half } })).enrolled).toBe(1);
    const [opener, followup] = await messagesOf(db(), await one(allEnrollments(db())));
    expect(opener?.body).toBe(
      `Hi Jane,\n\nBook: https://site.example/book/test-offer?r=${opener?.linkCode}`,
    );
    // No video of its own and none on the offer: the watch link is absent, its sentence drops.
    expect(followup?.body).toBe(`Read: https://site.example/recruiting/x?r=${followup?.linkCode}`);
    expect(followup?.linkCode).not.toBe(opener?.linkCode);
  });

  it("copy that needs a link skips the company when there is none to give", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const watch = new Map([
      ["opener", parseTemplate("opener", "Watch: {link.watch}")],
      ["followup", FOLLOWUP],
    ]);
    const stats = await runCompose(db(), { templates: watch, site: "https://site.example" });
    expect(stats).toMatchObject({ enrolled: 0, skipped_missing_facts: 1 });
  });

  it("auto-approve pins and approves", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const stats = await runCompose(db(), { autoApprove: true });
    expect(stats.auto_approved).toBe(2);
    const msgs = await allMessages(db());
    expect(new Set(msgs.map((m) => m.state))).toEqual(new Set(["approved"]));
    expect(msgs.every((m) => m.approvedAt !== null && m.approvedBy === "auto")).toBe(true);
  });

  it("track_opens mints a token per draft", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await runCompose(db(), { trackOpens: true });
    const msgs = await allMessages(db());
    expect(msgs.every((m) => /^[A-Za-z0-9_-]{32}$/.test(m.openToken ?? ""))).toBe(true);
    expect(new Set(msgs.map((m) => m.openToken)).size).toBe(2);
  });

  it("skips a person whose only check is older than the horizon", async () => {
    const company = await makeCompany(db());
    const stale = new Date(Date.now() - (VERIFICATION_HORIZON_DAYS + 5) * 86_400_000);
    await makePerson(db(), company, { email: "jane@oakbridge.example", verifiedCheckedAt: stale });
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_no_address).toBe(1);
  });

  it("uses the lead's corrected address, not the candidate's", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "old@oakbridge.example" });
    await db()
      .update(leads)
      .set({ email: "new@oakbridge.example" })
      .where(eq(leads.companyId, company.id));
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(1);
    const [opener] = await allMessages(db());
    expect(opener?.toEmail).toBe("new@oakbridge.example");
  });

  it("records template versions once per distinct version", async () => {
    const c1 = await makeCompany(db(), { domain: "oakbridge.example" });
    await makePerson(db(), c1, { email: "jane@oakbridge.example" });
    const c2 = await makeCompany(db(), { domain: "oakbridge2.example" });
    await makePerson(db(), c2, { email: "bob@oakbridge2.example" });
    await runCompose(db(), { limit: 1 });
    await runCompose(db());
    const rows = await db().select().from(templateVersions);
    expect(new Set(rows.map((r) => `${r.niche}|${r.template}|${r.version}`))).toEqual(
      new Set([`sec_ria|opener|${OPENER.version}`, `sec_ria|followup|${FOLLOWUP.version}`]),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(parseTemplate(row.template, row.source)).toEqual(TEMPLATES.get(row.template));
    }
  });

  it("pins the arm and the directory name flows through", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const armTemplates = new Map([
      ["pilot/opener", parseTemplate("pilot/opener", toSource(OPENER))],
      ["followup", FOLLOWUP],
    ]);
    await compose(db(), {
      niche: "sec_ria",
      sequence: twoEmailSequence("pilot/opener", "followup"),
      offer: "test-offer",
      templates: armTemplates,
      verificationHorizonDays: VERIFICATION_HORIZON_DAYS,
      senders: [SENDER],
    });
    const enrollment = await one(allEnrollments(db()));
    expect(enrollment.sequenceName).toBe("pilot-days-0-5");
    expect((enrollment.sequenceSnapshot as { arm: string }).arm).toBe("pilot");
    const [opener, followup] = await messagesOf(db(), enrollment);
    expect([opener?.template, followup?.template]).toEqual(["pilot/opener", "followup"]);
    const versions = await db().select().from(templateVersions);
    expect(new Set(versions.map((r) => r.template))).toEqual(new Set(["pilot/opener", "followup"]));
  });

  it("refuses to run without a sending inbox", async () => {
    await expect(runCompose(db(), { senders: [] })).rejects.toThrow(/sending address/);
  });

  it("refuses a sequence whose templates are unknown", async () => {
    await expect(
      runCompose(db(), { sequence: sequence("x", [sequenceStep("nope", 0)]) }),
    ).rejects.toThrow(/needs unknown templates: \['nope'\]/);
  });

  it("pins company, address, kind, sender and run", async () => {
    const company = await makeCompany(db());
    const person = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const runId = randomUUID();
    await db()
      .insert(runs)
      .values({ id: runId, command: "outreach compose", argv: {}, niche: "sec_ria" });
    await runCompose(db(), { runId });
    const enrollment = await one(allEnrollments(db()));
    expect(enrollment.companyId).toBe(company.id);
    expect(enrollment.personId).toBe(person.id);
    expect(enrollment.toEmail).toBe("jane@oakbridge.example");
    expect(enrollment.kind).toBe("person");
    expect(enrollment.sender).toBe(SENDER);
    expect(enrollment.runId).toBe(runId);
    const msgs = await messagesOf(db(), enrollment);
    expect(new Set(msgs.map((m) => m.runId))).toEqual(new Set([runId]));
    for (const m of msgs) {
      expect((m.provenance as { address_alternates: string[] }).address_alternates).toEqual([]);
    }
  });

  it("pins the inbox carrying the fewest live threads", async () => {
    const senders = ["a@x.test", "b@x.test"];
    for (let i = 0; i < 3; i++) {
      const company = await makeCompany(db(), { domain: `firm${i}.example` });
      await makePerson(db(), company, {
        full: `Owner Number${i}`,
        first: "Owner",
        email: `owner${i}@firm${i}.example`,
      });
    }
    const stats = await runCompose(db(), { senders });
    expect(stats.enrolled).toBe(3);
    const rows = await allEnrollments(db());
    expect(rows.map((e) => e.sender)).toEqual(["a@x.test", "b@x.test", "a@x.test"]);
    for (const e of rows) expect(await messagesOf(db(), e)).toHaveLength(2);
  });

  it("a second live enrollment for one company is refused by the index", async () => {
    const company = await makeCompany(db());
    const jane = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await makeEnrollment(db(), company, { person: jane, toEmail: "jane@oakbridge.example" });
    const colleague = await makePerson(db(), company, {
      full: "Paul Partner",
      first: "Paul",
      title: "Managing Partner",
    });
    await expect(
      makeEnrollment(db(), company, { person: colleague, toEmail: "paul@oakbridge.example" }),
    ).rejects.toThrow();
  });

  it("a second live enrollment for one address is refused by the index, case-insensitively", async () => {
    const company = await makeCompany(db(), { domain: "oakbridge.example" });
    const other = await makeCompany(db(), { domain: "othercorp.example" });
    const jane = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    const twin = await makePerson(db(), other, { full: "Jane Twin", first: "Jane" });
    await makeEnrollment(db(), company, { person: jane, toEmail: "jane@oakbridge.example" });
    await expect(
      makeEnrollment(db(), other, { person: twin, toEmail: "JANE@oakbridge.example" }),
    ).rejects.toThrow();
  });

  it("a role inbox may have no person but not share a live company", async () => {
    const company = await makeCompany(db(), { domain: "oakbridge.example" });
    const other = await makeCompany(db(), { domain: "othercorp.example" });
    const jane = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await makeEnrollment(db(), company, { person: jane, toEmail: "jane@oakbridge.example" });
    const roleInbox = await makeEnrollment(db(), other, {
      toEmail: "hello@othercorp.example",
      kind: "role_inbox",
    });
    expect(roleInbox.personId).toBeNull();
    await expect(
      makeEnrollment(db(), company, { toEmail: "info@oakbridge.example", kind: "role_inbox" }),
    ).rejects.toThrow();
  });

  it("a person-kind enrollment cannot lose its person", async () => {
    const company = await makeCompany(db());
    await expect(
      makeEnrollment(db(), company, { toEmail: "info@oakbridge.example" }),
    ).rejects.toThrow();
  });

  it("a stopped enrollment frees the index but not compose's policy", async () => {
    const company = await makeCompany(db());
    const person = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await runCompose(db());
    const { enrollments } = await import("../../src/schema.js");
    await db()
      .update(enrollments)
      .set({ state: "stopped", stopReason: "manual", stoppedAt: new Date() });
    const revived = await makeEnrollment(db(), company, {
      person,
      toEmail: "jane@oakbridge.example",
    });
    expect(revived.state).toBe("active");
    expect((await runCompose(db())).enrolled).toBe(0);
  });

  it("a person with two live addresses gets one enrollment and alternates", async () => {
    const company = await makeCompany(db());
    const person = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await addVerifiedAddress(db(), person, company, "j.doe@oakbridge.example", { rank: 1 });
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(1);
    const enrollment = await one(allEnrollments(db()));
    expect(enrollment.toEmail).toBe("jane@oakbridge.example");
    for (const m of await messagesOf(db(), enrollment)) {
      expect(m.toEmail).toBe("jane@oakbridge.example");
      expect((m.provenance as { address_alternates: string[] }).address_alternates).toEqual([
        "j.doe@oakbridge.example",
      ]);
    }
  });

  it("the same name at a sibling domain enrolls but is flagged", async () => {
    const first = await makeCompany(db(), { domain: "creatography.xyz" });
    await makePerson(db(), first, {
      full: "Ada Rowe",
      first: "Ada",
      email: "ada@creatography.xyz",
    });
    const second = await makeCompany(db(), { domain: "creatography.com" });
    await makePerson(db(), second, {
      full: "Ada  Rowe ",
      first: "Ada",
      email: "ada@creatography.com",
    });
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(2);
    expect(stats.flagged_possible_duplicate).toBe(1);
    const [earlier, later] = await allEnrollments(db());
    for (const m of await messagesOf(db(), earlier as never)) {
      expect(m.provenance).not.toHaveProperty("possible_duplicate_company");
    }
    for (const m of await messagesOf(db(), later as never)) {
      expect(
        (m.provenance as { possible_duplicate_company: unknown }).possible_duplicate_company,
      ).toEqual({
        enrollment_id: earlier?.id,
        company_id: first.id,
        domain: "creatography.xyz",
      });
    }
  });

  it("the pinned body carries the sender's signature", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "a@acme.example" });
    const block = "--\nWilliam Jin\nFounder, Wren Automation\nwrenautomation.com";
    await runCompose(db(), { signatures: { [SENDER]: block } });
    for (const m of await allMessages(db())) {
      expect(m.body.endsWith(`\n\n${block}`)).toBe(true);
      expect(m.body.split("William Jin")).toHaveLength(2);
      expect(m.body.startsWith("--")).toBe(false);
    }
  });

  it("a fleet with no signature composes unsigned bodies", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "b@acme.example" });
    await runCompose(db());
    for (const m of await allMessages(db())) expect(m.body).not.toContain("--");
  });

  it("refused facts are pinned on the draft and counted", async () => {
    const company = await makeCompany(db(), { name: "ACME WEALTH, LLC" });
    await makePerson(db(), company, { full: "D SMITH", first: "D", email: "d@oakbridge.example" });
    const greet = template("greet", [field("company_name")], [field("first_name", "there")]);
    const stats = await compose(db(), {
      niche: "sec_ria",
      sequence: sequence("g", [sequenceStep("greet", 0)]),
      offer: "test-offer",
      templates: new Map([["greet", greet]]),
      verificationHorizonDays: VERIFICATION_HORIZON_DAYS,
      senders: [SENDER],
    });
    expect(stats.enrolled).toBe(1);
    expect(stats.facts_refused).toBe(1);
    const [m] = await allMessages(db());
    expect(m?.subject).toBe("Acme Wealth");
    expect(m?.body).toBe("there");
    expect(prov(m).facts_refused).toEqual({ first_name: "D" });
  });

  it("companies stay untouched by compose", async () => {
    const company = await makeCompany(db(), { name: "ACME WEALTH, LLC" });
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await runCompose(db());
    const [row] = await db().select().from(companies).orderBy(asc(companies.id));
    expect(row?.name).toBe("ACME WEALTH, LLC");
  });
});
