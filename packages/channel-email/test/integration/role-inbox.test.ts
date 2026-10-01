/** Role-inbox pass: general inboxes from email picks, gates, and the pinned address chain. */
import { leads, people, suppressions } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compose, eligibleRoleInboxes } from "../../src/outreach/compose.js";
import { factsForCompany, halfOf } from "../../src/outreach/facts.js";
import { sequence, sequenceStep } from "../../src/outreach/sequences.js";
import { field, template, text } from "../../src/outreach/templates.js";
import { contactCandidates, verifications } from "../../src/schema.js";
import {
  allEnrollments,
  allMessages,
  makeCompany,
  makeExtraction,
  makePage,
  makePerson,
  makePick,
  makeRoleLead,
  messagesOf,
  roleCompany,
  SENDER,
  TABLES,
  VERIFICATION_HORIZON_DAYS,
} from "./compose-fixtures.js";

const OPENER = template(
  "opener",
  [text("automation at "), field("company_name")],
  [text("Hi "), field("first_name", "there"), text(",\n\nI build automations.")],
);
const BARE_OPENER = template(
  "opener",
  [text("automation at "), field("company_name")],
  [text("Hi "), field("first_name"), text(",")],
);
const FOLLOWUP = template("followup", null, [text("Bumping this.")]);
const SEQ = sequence("role-seq", [sequenceStep("opener", 0), sequenceStep("followup", 3)]);

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = () => pg.db;

const prov = (m: { provenance: unknown } | undefined): Record<string, unknown> =>
  (m?.provenance ?? {}) as Record<string, unknown>;
const address = (m: { provenance: unknown } | undefined): Record<string, unknown> =>
  (prov(m).address ?? {}) as Record<string, unknown>;

function run(
  opts: {
    opener?: typeof OPENER;
    kind?: "person" | "role_inbox";
    limit?: number;
    needsVerdict?: boolean;
  } = {},
) {
  return compose(db(), {
    niche: "sec_ria",
    sequence: SEQ,
    offer: "test-offer",
    templates: new Map([
      ["opener", opts.opener ?? OPENER],
      ["followup", FOLLOWUP],
    ]),
    verificationHorizonDays: VERIFICATION_HORIZON_DAYS,
    senders: [SENDER],
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.needsVerdict !== undefined ? { roleInboxNeedsVerdict: opts.needsVerdict } : {}),
  });
}

describe("role-inbox pass", () => {
  it("enrolls the pick's address for a company with no people", async () => {
    const company = await roleCompany(db());
    const stats = await run();
    expect(stats.enrolled).toBe(1);
    expect(stats.enrolled_role_inbox).toBe(1);
    expect(stats.enrolled_person).toBe(0);
    const [enrollment] = await allEnrollments(db());
    expect(enrollment?.kind).toBe("role_inbox");
    expect(enrollment?.personId).toBeNull();
    expect(enrollment?.companyId).toBe(company.id);
    expect(enrollment?.toEmail).toBe("info@frontdoor.example");
    const [opener, followup] = await allMessages(db());
    expect(opener?.subject).toBe("automation at Acme Advisors");
    expect(opener?.body).toBe("Hi there,\n\nI build automations.");
    expect(followup?.body).toBe("Bumping this.");
    const a = address(opener);
    expect(a.evidence).toBe("pick");
    expect(a.pick_method).toBe("auto_accept");
    expect(a.verification_result).toBeNull();
    expect(prov(opener).address_alternates).toEqual([]);
  });

  it("pins the scan page behind the pick", async () => {
    const company = await roleCompany(db());
    const doc = await makePage(db(), company, "https://frontdoor.example/contact", {
      scannedEmail: "info@frontdoor.example",
    });
    await run();
    const [opener] = await allMessages(db());
    expect(address(opener).source_url).toBe("https://frontdoor.example/contact");
    expect(address(opener).document_id).toBe(doc);
  });

  it("people go before inboxes", async () => {
    const staffed = await makeCompany(db(), { domain: "oakbridge.example" });
    await makePerson(db(), staffed, { email: "jane@oakbridge.example" });
    const roleOnly = await roleCompany(db());
    const stats = await run();
    expect(stats.enrolled).toBe(2);
    const rows = await allEnrollments(db());
    expect(rows.map((e) => [e.companyId, e.kind])).toEqual([
      [staffed.id, "person"],
      [roleOnly.id, "role_inbox"],
    ]);
  });

  it("a company whose only person is stale falls to the inbox", async () => {
    const company = await makeCompany(db());
    const stale = new Date(Date.now() - (VERIFICATION_HORIZON_DAYS + 5) * 86_400_000);
    await makePerson(db(), company, { email: "jane@oakbridge.example", verifiedCheckedAt: stale });
    await makeRoleLead(db(), company, "info@oakbridge.example");
    await makePick(db(), company, "info@oakbridge.example", { method: "classify" });
    const stats = await run();
    expect(stats.enrolled).toBe(1);
    expect(stats.enrolled_role_inbox).toBe(1);
    const [opener] = await allMessages(db());
    expect(opener?.toEmail).toBe("info@oakbridge.example");
    expect(address(opener).pick_method).toBe("classify");
  });

  it("a person-attributed address is never treated as a role inbox", async () => {
    const company = await makeCompany(db());
    await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await db().update(people).set({ isTestimonial: true }).where(eq(people.companyId, company.id));
    await makePick(db(), company, "jane@oakbridge.example");
    const stats = await run();
    expect(stats.enrolled).toBe(0);
  });

  it("with roleInboxNeedsVerdict, an unchecked inbox waits and a proven one goes", async () => {
    const unchecked = await roleCompany(db(), "a.example", "info@a.example");
    const catchAll = await roleCompany(db(), "b.example", "info@b.example");
    const risky = await roleCompany(db(), "c.example", "info@c.example");
    const verdict = async (email: string, result: "catch_all" | "risky") => {
      const [lead] = await db().select().from(leads).where(eq(leads.email, email));
      await db()
        .insert(verifications)
        .values({ leadId: (lead as { id: number }).id, email, verifier: "smtp", result, raw: {} });
    };
    await verdict("info@b.example", "catch_all");
    await verdict("info@c.example", "risky");

    const listed = await eligibleRoleInboxes(db(), { niche: "sec_ria", needsVerdict: true });
    expect(listed.map((r) => r.companyId)).toEqual([catchAll.id]);
    const stats = await run({ needsVerdict: true });
    expect(stats.enrolled_role_inbox).toBe(1);
    const rows = await allEnrollments(db());
    expect(rows.map((e) => e.companyId)).toEqual([catchAll.id]);
    expect(rows.map((e) => e.companyId)).not.toContain(unchecked.id);
    expect(rows.map((e) => e.companyId)).not.toContain(risky.id);
    // Off, the unchecked and the risky inboxes go too (the invalid gate still holds).
    expect((await run()).enrolled_role_inbox).toBe(2);
  });

  it("gates: suppressed lead status, invalid verification, opt-out", async () => {
    const suppressedLead = await makeCompany(db(), { domain: "a.example" });
    await makeRoleLead(db(), suppressedLead, "info@a.example", "suppressed");
    await makePick(db(), suppressedLead, "info@a.example");

    const invalid = await makeCompany(db(), { domain: "b.example" });
    const lead = await makeRoleLead(db(), invalid, "info@b.example");
    await db().insert(verifications).values({
      leadId: lead.id,
      email: "info@b.example",
      verifier: "test",
      result: "invalid",
      raw: {},
    });
    await makePick(db(), invalid, "info@b.example");

    const optedOut = await roleCompany(db(), "c.example", "info@c.example");
    await db()
      .insert(suppressions)
      .values({ kind: "email", value: "info@c.example", reason: "opt_out" });

    const stats = await run();
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_suppressed).toBe(1);
    const listing = await eligibleRoleInboxes(db(), { niche: "sec_ria" });
    expect(listing.map((r) => [r.companyId, r.wouldEnroll])).toEqual([[optedOut.id, false]]);
  });

  it("a bare first_name refuses the inbox", async () => {
    await roleCompany(db());
    const stats = await run({ opener: BARE_OPENER });
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_missing_facts).toBe(1);
  });

  it("kind narrows the pass and limit is shared", async () => {
    const staffed = await makeCompany(db(), { domain: "oakbridge.example" });
    await makePerson(db(), staffed, { email: "jane@oakbridge.example" });
    await roleCompany(db());
    const roleOnly = await run({ kind: "role_inbox" });
    expect([roleOnly.enrolled_person, roleOnly.enrolled_role_inbox]).toEqual([0, 1]);
    await truncate(db(), TABLES);
    const staffed2 = await makeCompany(db(), { domain: "oakbridge.example" });
    await makePerson(db(), staffed2, { email: "jane@oakbridge.example" });
    await roleCompany(db());
    const limited = await run({ limit: 1 });
    expect([limited.enrolled_person, limited.enrolled_role_inbox]).toEqual([1, 0]);
  });

  it("the newest pick decides and the listing honours exclusions", async () => {
    const company = await makeCompany(db(), { domain: "frontdoor.example" });
    await makeRoleLead(db(), company, "old@frontdoor.example");
    await makeRoleLead(db(), company, "new@frontdoor.example");
    await makePick(db(), company, "old@frontdoor.example");
    await makePick(db(), company, "new@frontdoor.example", { promptVersion: "v2" });
    const listing = await eligibleRoleInboxes(db(), { niche: "sec_ria" });
    expect(listing.map((r) => r.email)).toEqual(["new@frontdoor.example"]);
    expect(
      await eligibleRoleInboxes(db(), {
        niche: "sec_ria",
        excludeCompanies: new Set([company.id]),
      }),
    ).toEqual([]);
    const facts = await factsForCompany(db(), company.id, null);
    expect(facts.values).toEqual({
      company_id: company.id,
      company_name: "Acme Advisors",
      company_domain: "frontdoor.example",
      company_niche: "sec_ria",
      half: halfOf(company.id),
    });
    const stats = await run();
    expect(stats.enrolled).toBe(1);
    expect((await allEnrollments(db()))[0]?.toEmail).toBe("new@frontdoor.example");
  });

  it("a newer pick with no address retires the company", async () => {
    const company = await roleCompany(db());
    await makePick(db(), company, null, { promptVersion: "v2" });
    expect(await eligibleRoleInboxes(db(), { niche: "sec_ria" })).toEqual([]);
    expect((await run()).enrolled).toBe(0);
  });
});

describe("person address chain", () => {
  it("person drafts pin the whole chain", async () => {
    const company = await makeCompany(db());
    const doc = await makePage(db(), company, "https://oakbridge.example/team");
    const extraction = await makeExtraction(db(), doc);
    const person = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await db()
      .update(contactCandidates)
      .set({ sourceRef: `enrichment:${extraction} https://oakbridge.example/team` })
      .where(eq(contactCandidates.personId, person.id));
    await run();
    const [enrollment] = await allEnrollments(db());
    const msgs = await messagesOf(db(), enrollment as never);
    expect(msgs).toHaveLength(2);
    const [lead] = await db().select().from(leads).where(eq(leads.companyId, company.id));
    const [verification] = await db().select().from(verifications);
    for (const m of msgs) {
      const a = address(m);
      expect(a.email).toBe("jane@oakbridge.example");
      expect(a.lead_id).toBe(lead?.id);
      expect(a.verification_id).toBe(verification?.id);
      expect(a.verifier).toBe("test");
      expect(a.verified_at).not.toBeNull();
      expect(a.evidence).toBe("scraped");
      expect(a.extraction_enrichment_id).toBe(extraction);
      expect(a.document_id).toBe(doc);
      expect(a.source_url).toBe("https://oakbridge.example/team");
      expect(a.pick_enrichment_id).toBeNull();
    }
  });

  it("a pattern address falls back to the person's page", async () => {
    const company = await makeCompany(db());
    const doc = await makePage(db(), company, "https://oakbridge.example/about");
    const extraction = await makeExtraction(db(), doc);
    const person = await makePerson(db(), company, { email: "jane@oakbridge.example" });
    await db()
      .update(people)
      .set({ originRef: `enrichment:${extraction} https://oakbridge.example/about` })
      .where(eq(people.id, person.id));
    await db()
      .update(contactCandidates)
      .set({ evidence: "guessed_pattern", pattern: "{first}", sourceRef: "pattern:{first}" })
      .where(eq(contactCandidates.personId, person.id));
    await run();
    const [opener] = await allMessages(db());
    const a = address(opener);
    expect(a.evidence).toBe("guessed_pattern");
    expect(a.pattern).toBe("{first}");
    expect(a.extraction_enrichment_id).toBe(extraction);
    expect(a.document_id).toBe(doc);
    expect(a.source_url).toBe("https://oakbridge.example/about");
  });
});
