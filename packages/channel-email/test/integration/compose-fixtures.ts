/** Shared fixtures for the compose and role-inbox suites: firms, people with a verified address, raw enrollments. */
import {
  type Company,
  companies,
  imports,
  type Lead,
  leads,
  type Person,
  people,
} from "@wren/core";
import { field, type Template, template, text } from "@wren/core/slots";
import type { Db } from "@wren/db";
import { documents, enrichments } from "@wren/research/schema";
import { asc, eq } from "drizzle-orm";
import { type ComposeOptions, compose } from "../../src/outreach/compose.js";
import { sequence, sequenceStep } from "../../src/outreach/sequences.js";
import {
  contactCandidates,
  type Enrollment,
  type EnrollmentKind,
  enrollments,
  type Message,
  messages,
  verifications,
} from "../../src/schema.js";

export const VERIFICATION_HORIZON_DAYS = 45;
export const SENDER = "will@wren-automation.test";

export const OPENER = template(
  "opener",
  [text("Quick question, "), field("first_name")],
  [text("Hi "), field("first_name"), text(",\n\nI build automations for advisers.")],
);
export const FOLLOWUP = template("followup", null, [text("Bumping this in case it got buried.")]);
export const SEQ = sequence("test-seq", [sequenceStep("opener", 0), sequenceStep("followup", 3)]);
export const TEMPLATES: ReadonlyMap<string, Template> = new Map([
  ["opener", OPENER],
  ["followup", FOLLOWUP],
]);

export const TABLES = [
  "runs",
  "imports",
  "companies",
  "suppressions",
  "leads",
  "documents",
  "enrichments",
  "enrollments",
  "findings",
  "template_versions",
];

export async function makeCompany(
  db: Db,
  opts: { domain?: string; niche?: string; name?: string; raw?: Record<string, unknown> } = {},
): Promise<Company> {
  const [row] = await db
    .insert(companies)
    .values({
      domain: opts.domain ?? "oakbridge.example",
      name: opts.name ?? "Acme Advisors",
      niche: opts.niche ?? "sec_ria",
      raw: opts.raw ?? {},
    })
    .returning();
  return row as Company;
}

export async function makeBatch(db: Db): Promise<number> {
  const [row] = await db
    .insert(imports)
    .values({ sourceType: "test", sourceRef: "inline", stats: {} })
    .returning({ id: imports.id });
  return (row as { id: number }).id;
}

/** A VERIFIED lead + VERIFIED candidate + VALID verification for a person (the person-pass gate). */
export async function addVerifiedAddress(
  db: Db,
  person: Person,
  company: Company,
  email: string,
  opts: { rank?: number; verifiedCheckedAt?: Date } = {},
): Promise<Lead> {
  const [lead] = await db
    .insert(leads)
    .values({
      email,
      status: "verified",
      raw: {},
      importId: await makeBatch(db),
      companyId: company.id,
      personId: person.id,
    })
    .returning();
  const [candidate] = await db
    .insert(contactCandidates)
    .values({
      personId: person.id,
      email,
      domain: email.slice(email.lastIndexOf("@") + 1),
      evidence: "scraped",
      rank: opts.rank ?? 0,
      state: "verified",
      sourceRef: "test",
      leadId: (lead as Lead).id,
    })
    .returning();
  await db.insert(verifications).values({
    leadId: (lead as Lead).id,
    contactCandidateId: (candidate as { id: number }).id,
    email,
    verifier: "test",
    result: "valid",
    raw: {},
    ...(opts.verifiedCheckedAt ? { checkedAt: opts.verifiedCheckedAt } : {}),
  });
  return lead as Lead;
}

export async function makePerson(
  db: Db,
  company: Company,
  opts: {
    full?: string;
    first?: string;
    title?: string;
    email?: string;
    verifiedCheckedAt?: Date;
  } = {},
): Promise<Person> {
  const full = opts.full ?? "Jane Doe";
  const [person] = await db
    .insert(people)
    .values({
      companyId: company.id,
      fullName: full,
      firstName: opts.first ?? "Jane",
      lastName: full.split(" ").at(-1) ?? full,
      title: opts.title ?? "Owner",
      isCompliance: false,
      origin: "website",
      originRef: "test",
      raw: {},
    })
    .returning();
  if (opts.email !== undefined) {
    await addVerifiedAddress(db, person as Person, company, opts.email, {
      ...(opts.verifiedCheckedAt ? { verifiedCheckedAt: opts.verifiedCheckedAt } : {}),
    });
  }
  return person as Person;
}

export function runCompose(db: Db, overrides: Partial<ComposeOptions> = {}) {
  return compose(db, {
    niche: "sec_ria",
    sequence: SEQ,
    offer: "test-offer",
    templates: TEMPLATES,
    verificationHorizonDays: VERIFICATION_HORIZON_DAYS,
    senders: [SENDER],
    ...overrides,
  });
}

/** A raw enrollment row, bypassing compose — the way to prove what the DB itself refuses. */
export async function makeEnrollment(
  db: Db,
  company: Company,
  opts: {
    toEmail: string;
    person?: Person | null;
    kind?: EnrollmentKind;
    sender?: string;
    state?: "active" | "finished" | "stopped";
  },
): Promise<Enrollment> {
  const [row] = await db
    .insert(enrollments)
    .values({
      personId: opts.person?.id ?? null,
      companyId: company.id,
      kind: opts.kind ?? "person",
      toEmail: opts.toEmail,
      sender: opts.sender ?? SENDER,
      niche: "sec_ria",
      sequenceName: SEQ.name,
      sequenceSnapshot: { name: SEQ.name, steps: [] },
      offer: "test-offer",
      state: opts.state ?? "active",
    })
    .returning();
  return row as Enrollment;
}

export const allEnrollments = (db: Db) =>
  db.select().from(enrollments).orderBy(asc(enrollments.id));
export const messagesOf = (db: Db, enrollment: Enrollment) =>
  db
    .select()
    .from(messages)
    .where(eq(messages.enrollmentId, enrollment.id))
    .orderBy(asc(messages.step));
export const allMessages = (db: Db): Promise<Message[]> =>
  db.select().from(messages).orderBy(asc(messages.enrollmentId), asc(messages.step));

/** The pick's own import of a role address: a lead with no person behind it, never verified. */
export async function makeRoleLead(
  db: Db,
  company: Company,
  email: string,
  status: "imported" | "suppressed" = "imported",
): Promise<Lead> {
  const [lead] = await db
    .insert(leads)
    .values({
      email,
      status,
      source: "email-pick",
      raw: {},
      importId: await makeBatch(db),
      companyId: company.id,
    })
    .returning();
  return lead as Lead;
}

export async function makePick(
  db: Db,
  company: Company,
  bestSendTo: string | null,
  opts: { method?: string; promptVersion?: string } = {},
): Promise<number> {
  const [row] = await db
    .insert(enrichments)
    .values({
      companyId: company.id,
      kind: "email_pick",
      model: "fake",
      promptVersion: opts.promptVersion ?? "v1",
      output: {
        pick: {
          method: opts.method ?? "auto_accept",
          emails: bestSendTo ? [{ email: bestSendTo, classification: "role" }] : [],
          best_send_to: bestSendTo,
        },
      },
    })
    .returning({ id: enrichments.id });
  return (row as { id: number }).id;
}

/** A fetched page, optionally with the email-scan row that found an address on it. */
export async function makePage(
  db: Db,
  company: Company,
  url: string,
  opts: { scannedEmail?: string } = {},
): Promise<number> {
  const [doc] = await db
    .insert(documents)
    .values({
      companyId: company.id,
      url,
      kind: "webpage",
      contentHash: `hash-${url}`,
      text: "page text",
    })
    .returning({ id: documents.id });
  const id = (doc as { id: number }).id;
  if (opts.scannedEmail !== undefined) {
    await db.insert(enrichments).values({
      documentId: id,
      kind: "email_scan",
      model: "deterministic",
      promptVersion: "v1",
      output: { signals: [{ email: opts.scannedEmail, page_url: url, source: "mailto" }] },
    });
  }
  return id;
}

export async function makeExtraction(db: Db, documentId: number): Promise<number> {
  const [row] = await db
    .insert(enrichments)
    .values({
      documentId,
      kind: "people_extraction",
      model: "fake",
      promptVersion: "v2",
      output: {},
    })
    .returning({ id: enrichments.id });
  return (row as { id: number }).id;
}

/** A company with no people at all — the general-inbox case. */
export async function roleCompany(db: Db, domain = "frontdoor.example", email = `info@${domain}`) {
  const company = await makeCompany(db, { domain });
  await makeRoleLead(db, company, email);
  await makePick(db, company, email);
  return company;
}
