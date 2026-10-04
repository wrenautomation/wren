/**
 * Movers and "no signal, no draft" against the migrated schema: a mover's
 * address at the new firm (site, guesses, the check), then who scoring sends
 * to compose and who it keeps warm. Synthetic people and firms only.
 */
import { type EmailVerifier, FakeVerifier, type LocalCheckerLike } from "@wren/channel-email";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import type { HomepageFetcher } from "@wren/research/discovery";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeSubjects } from "../../src/compose.js";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { checkCrmEmails } from "../../src/crm/verify.js";
import { findMoverAddresses, moversDue } from "../../src/movers.js";
import { scoreCrmContacts } from "../../src/score.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
const db = () => pg.db;

const checker: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

/** The free check's stand-in: valid only for the listed addresses, catch-all for the listed domains. */
function prober(valid: string[], catchAll: string[] = []): EmailVerifier & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: "smtp",
    authoritative: true,
    costsCredits: false,
    asked,
    async verify(email) {
      asked.push(email);
      const domain = email.split("@")[1] ?? "";
      if (catchAll.includes(domain)) return { result: "catch_all", raw: { reason: "accepts_all" } };
      return valid.includes(email)
        ? { result: "valid", raw: { reason: "accepted" } }
        : { result: "invalid", raw: { reason: "rejected" } };
    },
  };
}

const SITES: Record<string, string> = {
  "betalabs.com": "Beta Labs",
  "deltasystems.com": "Delta Systems",
};
const fetched: string[] = [];
const fetchHomepage: HomepageFetcher = async (d) => {
  fetched.push(d);
  const name = SITES[d];
  return name ? { url: `https://${d}/`, title: name, text: `Welcome to ${name}` } : null;
};
const resolves = async (d: string) => d in SITES;

const HEADER = "ID,Name,Email,Company,Website,Owner";
const ROWS = [
  "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com,",
  "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com,",
  "3,Carl Poe,carl@betarecruit.com,Beta Recruit,https://betarecruit.com,",
  "4,Dana Fox,dana@gammahire.com,Gamma Hire,https://gammahire.com,",
  "5,Eve Kim,eve@gammahire.com,Gamma Hire,https://gammahire.com,",
  "6,Finn Lo,finn@zetaco.com,Zeta Co,https://zetaco.com,",
  "7,Gus Ray,gus@zetaco.com,Zeta Co,https://zetaco.com,",
];

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => {
  const [r] = await db().execute<T>(q);
  if (!r) throw new Error("no row");
  return r as T;
};
const pid = async (first: string) =>
  (await one<{ id: number }>(sql`select id from people where first_name = ${first}`)).id;
const cid = async (name: string) =>
  (await one<{ id: number }>(sql`select id from companies where name = ${name}`)).id;

let keys = 0;
async function finding(kind: string, who: { person?: number; company?: number }, value: object) {
  keys += 1;
  const r = await one<{ id: number }>(sql`
    insert into findings (kind, person_id, company_id, fact_key, value, confidence, via, observed_at)
    values (${kind}, ${who.person ?? null}, ${who.company ?? null}, ${`t:${keys}`},
      ${JSON.stringify(value)}::jsonb, 0.9, 'linkedin@research', now())
    returning id`);
  return r.id;
}
const moved = async (first: string, from: string, to: string) =>
  finding("job_change", { person: await pid(first) }, { from, to, title: "Recruiter" });
async function hiringAt(company: string) {
  const c = await cid(company);
  const id = await finding("hiring", { company: c }, { count: 2, roles: [] });
  await db().execute(sql`
    insert into company_checks (company_id, state, finding_id, tried)
    values (${c}, 'hiring', ${id}, '[]'::jsonb)`);
}
/** Everyone gets a written brief, so only the score and the address decide. */
async function briefAll() {
  await db().execute(sql`
    insert into briefs (person_id, state, text, citations, dropped, inputs_hash, model, prompt_version)
    select id, 'written', 'Something true. [c1]', '{"findings":[],"crm":[1]}'::jsonb, '[]'::jsonb,
      'h' || id, 'fake', 'v4' from people`);
}
const mover = async (first: string) =>
  db().execute<{ outcome: string; domain: string | null; email: string | null }>(sql`
    select ma.outcome, ma.domain, cc.email from mover_addresses ma
    left join contact_candidates cc on cc.id = ma.candidate_id
    where ma.person_id = ${await pid(first)}`);

beforeEach(async () => {
  await truncate(pg.db, [
    "mover_addresses",
    "messages",
    "enrollments",
    "briefs",
    "contact_scores",
    "company_checks",
    "findings",
    "verifications",
    "contact_candidates",
    "crm_contacts",
    "sightings",
    "import_errors",
    "people",
    "companies",
    "imports",
  ]);
  fetched.length = 0;
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  const csv = [HEADER, ...ROWS].join("\n");
  await runCrmImport(db(), new CrmCsvSource(f, "export.csv", new TextEncoder().encode(csv)));
  await checkCrmEmails(db(), new FakeVerifier({ authoritative: true }), checker);
});

describe("a mover's address at the new firm", () => {
  it("guesses on the new firm's site, best first, and keeps the first that checks out", async () => {
    await moved("Jane", "Acme Staffing", "Beta Labs");
    const v = prober(["jdoe@betalabs.com"]);
    const stats = await findMoverAddresses(db(), { verifier: v, checker, fetchHomepage, resolves });
    expect(stats).toMatchObject({ selected: 1, found: 1, aborted: null });
    expect(v.asked).toEqual(["jane.doe@betalabs.com", "jdoe@betalabs.com"]);
    expect(await mover("Jane")).toEqual([
      { outcome: "found", domain: "betalabs.com", email: "jdoe@betalabs.com" },
    ]);
    const states = await db().execute<{ email: string; state: string; evidence: string }>(sql`
      select email, state, evidence from contact_candidates where domain = 'betalabs.com' order by rank`);
    expect(states).toEqual([
      { email: "jane.doe@betalabs.com", state: "rejected", evidence: "guessed_pattern" },
      { email: "jdoe@betalabs.com", state: "verified", evidence: "guessed_pattern" },
      { email: "jane@betalabs.com", state: "candidate", evidence: "guessed_pattern" },
    ]);
    // Found is final: the next run asks nobody.
    expect(await moversDue(db())).toBe(0);
  });

  it("a new firm with no site of its own: no domain, nothing guessed", async () => {
    await moved("Bob", "Acme Staffing", "Nowhere Ventures");
    const v = prober([]);
    const stats = await findMoverAddresses(db(), { verifier: v, checker, fetchHomepage, resolves });
    expect(stats).toMatchObject({ selected: 1, noDomain: 1 });
    expect(v.asked).toEqual([]);
    expect(await mover("Bob")).toEqual([{ outcome: "no_domain", domain: null, email: null }]);
  });

  it("a catch-all server proves nothing: it stops at the first answer, no address", async () => {
    await moved("Carl", "Beta Recruit", "Delta Systems");
    const v = prober([], ["deltasystems.com"]);
    const stats = await findMoverAddresses(db(), { verifier: v, checker, fetchHomepage, resolves });
    expect(stats).toMatchObject({ catchAll: 1, found: 0 });
    expect(v.asked).toHaveLength(1);
    expect(await mover("Carl")).toEqual([
      { outcome: "catch_all", domain: "deltasystems.com", email: null },
    ]);
  });

  it("a firm already in the CRM gives its domain, no site fetched", async () => {
    await moved("Jane", "Acme Staffing", "gamma hire");
    const v = prober(["jane.doe@gammahire.com"]);
    await findMoverAddresses(db(), { verifier: v, checker, fetchHomepage, resolves });
    expect(fetched).toEqual([]);
    expect((await mover("Jane"))[0]?.email).toBe("jane.doe@gammahire.com");
  });

  it("left, or a move that names no firm: nobody to look for", async () => {
    await finding("left", { person: await pid("Dana") }, { from: "Gamma Hire" });
    await finding("job_change", { person: await pid("Eve") }, { from: "Gamma Hire", to: "  " });
    expect(await moversDue(db())).toBe(0);
  });

  it("a miss is tried again after a month; a server hold writes nothing and is tried next run", async () => {
    await moved("Bob", "Acme Staffing", "Nowhere Ventures");
    const deps = { verifier: prober([]), checker, fetchHomepage, resolves };
    await findMoverAddresses(db(), deps);
    expect(await moversDue(db())).toBe(0);
    await db().execute(sql`update mover_addresses set tried_at = now() - interval '31 days'`);
    expect(await moversDue(db())).toBe(1);

    await moved("Jane", "Acme Staffing", "Beta Labs");
    const greylist: EmailVerifier = {
      ...prober([]),
      async verify() {
        return { result: "risky", raw: { reason: "greylisted" } };
      },
    };
    const stats = await findMoverAddresses(db(), { ...deps, verifier: greylist });
    expect(stats.held).toBe(1);
    expect(await mover("Jane")).toEqual([]);
  });

  it("only the free, trusted check: a paid or untrusted verifier stops the stage", async () => {
    await moved("Jane", "Acme Staffing", "Beta Labs");
    const paid = { ...prober([]), name: "millionverifier", costsCredits: true };
    expect(
      (await findMoverAddresses(db(), { verifier: paid, checker, fetchHomepage, resolves }))
        .aborted,
    ).toMatch(/costs credits/);
    expect(
      (
        await findMoverAddresses(db(), {
          verifier: new FakeVerifier(),
          checker,
          fetchHomepage,
          resolves,
        })
      ).aborted,
    ).toMatch(/doesn't count/);
    expect(await mover("Jane")).toEqual([]);
  });
});

describe("no signal, no draft", () => {
  it("drafts movers with a checked address and people whose firm is hiring; keeps the rest warm", async () => {
    await moved("Jane", "Acme Staffing", "Beta Labs"); // found at the new firm
    await moved("Bob", "Acme Staffing", "Nowhere Ventures"); // no domain
    await moved("Carl", "Beta Recruit", "Delta Systems"); // catch-all
    await finding("left", { person: await pid("Dana") }, { from: "Gamma Hire" });
    await finding("still_there", { person: await pid("Eve") }, { company: "Gamma Hire" });
    await finding("still_there", { person: await pid("Finn") }, { company: "Zeta Co" });
    await finding("still_there", { person: await pid("Gus") }, { company: "Zeta Co" });
    await hiringAt("Gamma Hire");
    await findMoverAddresses(db(), {
      verifier: prober(["jane.doe@betalabs.com"], ["deltasystems.com"]),
      checker,
      fetchHomepage,
      resolves,
    });
    const stats = await scoreCrmContacts(db());
    expect(stats).toMatchObject({ moved: 3, left: 1, hiringThere: 1, stillThere: 2, keepWarm: 2 });
    await briefAll();

    const steps = await db().execute<{ first_name: string; next_step: string; reason: string }>(sql`
      select p.first_name, s.next_step, s.reasons->0->>'reason' reason
      from contact_scores s join people p on p.id = s.person_id order by p.id`);
    expect(steps.map((r) => [r.first_name, r.next_step])).toEqual([
      ["Jane", "reach_out"],
      ["Bob", "reach_out"],
      ["Carl", "reach_out"],
      ["Dana", "none"],
      ["Eve", "reach_out"],
      ["Finn", "keep_warm"],
      ["Gus", "keep_warm"],
    ]);
    expect(steps[0]?.reason).toBe("Moved to Beta Labs, now Recruiter");
    expect(steps[5]?.reason).toBe("Still at Zeta Co, nothing new");

    const due = await composeSubjects(db());
    expect(due.map((s) => [s.firstName, s.email, s.movedTo, s.evidence])).toEqual([
      ["Eve", "eve@gammahire.com", null, "crm"],
      ["Jane", "jane.doe@betalabs.com", "Beta Labs", "guessed_pattern"],
    ]);
  });

  it("a mover counts at the new firm: a live thread at the old one doesn't hold them", async () => {
    await moved("Jane", "Acme Staffing", "Beta Labs");
    await findMoverAddresses(db(), {
      verifier: prober(["jane.doe@betalabs.com"]),
      checker,
      fetchHomepage,
      resolves,
    });
    const beta = await cid("Beta Labs");
    // A firm row lost (or a pass from before filing) makes the stage due again, and it refiles.
    await db().execute(sql`delete from companies where id = ${beta}`);
    expect(await moversDue(db())).toBe(1);
    await findMoverAddresses(db(), { verifier: prober([]), checker, fetchHomepage, resolves });
    expect(await moversDue(db())).toBe(0);
    const refiled = await cid("Beta Labs");
    expect(
      (await one<{ domain: string }>(sql`select domain from companies where id = ${refiled}`))
        .domain,
    ).toBe("betalabs.com");
    await db().execute(sql`
      insert into enrollments (person_id, niche, sequence_name, sequence_snapshot, offer, state,
        company_id, kind, to_email, sender)
      values (${await pid("Bob")}, 'reactivation', 'reactivation', '{}'::jsonb, 'reactivation',
        'active', ${await cid("Acme Staffing")}, 'person', 'bob@acmestaffing.com', 'x@mail.example')`);
    await scoreCrmContacts(db());
    await briefAll();
    const [jane] = await composeSubjects(db());
    expect(jane).toMatchObject({ firstName: "Jane", companyId: refiled, firm: "Acme Staffing" });
  });

  it("a mover's old CRM address is never used, verified or not", async () => {
    await moved("Jane", "Acme Staffing", "Beta Labs");
    await scoreCrmContacts(db());
    await briefAll();
    expect((await composeSubjects(db())).map((s) => s.firstName)).toEqual([]);
  });
});
