/** AI fills against the migrated schema: compose, refresh and the cache, with a scripted model. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseTemplate } from "@wren/core/slots";
import { factsFor } from "../../src/outreach/facts.js";
import { CASUAL_COMPANY, CASUAL_PERSON, makeFiller } from "../../src/outreach/fills.js";
import { refreshQueue } from "../../src/outreach/refresh.js";
import { fills } from "../../src/schema.js";
import {
  allMessages,
  FOLLOWUP,
  makeCompany,
  makePerson,
  runCompose,
  SENDER,
  TABLES,
} from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "fills"]));
const db = () => pg.db;

const OPENER = parseTemplate(
  "opener",
  "Subject: hi\n\nHi {first_name|there},\n\nI've followed {company_short} for a while.(( You place <<In a few words, the roles {company_short} fills>>.))\n",
);
const TEMPLATES = new Map([
  ["opener", OPENER],
  ["followup", FOLLOWUP],
]);

/** A scripted model: answers by system prompt and input, and counts what it was asked. */
function model(answers: { company?: Record<string, unknown>; person?: Record<string, unknown> }) {
  const asked: string[] = [];
  const llm = new FakeLlm({
    respond: (prompt, system) => {
      asked.push(prompt);
      if (system === CASUAL_COMPANY)
        return JSON.stringify(answers.company?.[prompt] ?? { name: null });
      if (system === CASUAL_PERSON)
        return JSON.stringify(answers.person?.[prompt] ?? { first: null });
      return JSON.stringify({ text: "travel nurses" });
    },
  });
  return { llm, asked };
}

const LOUD = "ASSERTIVE STAFFING SERVICES INC";
const CASUAL = { [LOUD]: { name: "Assertive Staffing Services", short: "Assertive Staffing" } };

describe("fills", () => {
  it("compose writes the model's names and fills the slot; a junk first name falls back", async () => {
    const company = await makeCompany(db(), { name: LOUD });
    await makePerson(db(), company, { first: "Sales", full: "Sales Team", email: "a@x.example" });
    const { llm } = model({ company: CASUAL });
    const stats = await runCompose(db(), { templates: TEMPLATES, fill: makeFiller(db(), llm) });
    expect(stats.enrolled).toBe(1);
    const [opener] = await allMessages(db());
    expect(opener?.body).toBe(
      "Hi there,\n\nI've followed Assertive Staffing for a while. You place travel nurses.",
    );
    const rows = await db().select().from(fills);
    expect(rows.map((r) => [r.kind, r.value, r.refused]).sort()).toEqual([
      ["company", { name: "Assertive Staffing Services", short: "Assertive Staffing" }, null],
      ["person", null, "model: no first name"],
      ["slot", { text: "travel nurses" }, null],
    ]);
  });

  it("every answer is cached: a second filler asks nothing", async () => {
    const company = await makeCompany(db(), { name: LOUD });
    const person = await makePerson(db(), company, { first: "JANE", full: "JANE DOE" });
    const facts = await factsFor(db(), person.id, null);
    const first = model({
      company: CASUAL,
      person: { "first_name: JANE / full_name: JANE DOE": { first: "Jane" } },
    });
    await makeFiller(db(), first.llm).fill(facts, [OPENER]);
    expect(first.asked).toHaveLength(3);
    const again = model({});
    const filled = await makeFiller(db(), again.llm).fill(facts, [OPENER]);
    expect(again.asked).toHaveLength(0);
    expect(filled.values.first_name).toBe("Jane");
    expect(filled.values.company_short).toBe("Assertive Staffing");
  });

  it("a model's initials never ship: the short falls back to the name", async () => {
    const company = await makeCompany(db(), { name: LOUD });
    const person = await makePerson(db(), company);
    const { llm } = model({
      company: { [LOUD]: { name: "Assertive Staffing Services", short: "ASS" } },
    });
    const filled = await makeFiller(db(), llm).fill(await factsFor(db(), person.id, null), []);
    expect(filled.values.company_short).toBe("Assertive Staffing Services");
  });

  it("not a company: the firm stays out and the refusal is on record", async () => {
    const company = await makeCompany(db(), { name: "Odessa, TX" });
    await makePerson(db(), company, { email: "a@x.example" });
    const { llm } = model({});
    const stats = await runCompose(db(), { templates: TEMPLATES, fill: makeFiller(db(), llm) });
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_missing_facts).toBe(1);
    const [row] = await db().select().from(fills);
    expect(row?.refused).toBe("model: not a company name");
  });

  it("a name the model made up is refused", async () => {
    const company = await makeCompany(db(), { name: "Tulsa Nurse Partners" });
    const person = await makePerson(db(), company);
    const { llm } = model({
      company: { "Tulsa Nurse Partners": { name: "Tulsa Nursing", short: "Tulsa" } },
    });
    const filled = await makeFiller(db(), llm).fill(await factsFor(db(), person.id, null), []);
    expect(filled.values.company_short).toBeUndefined();
    expect(filled.refused.company_name).toBe("Tulsa Nurse Partners");
  });

  it("refresh re-renders the queue with the model's names", async () => {
    const company = await makeCompany(db(), { name: LOUD });
    await makePerson(db(), company, { email: "a@x.example" });
    await runCompose(db(), { templates: TEMPLATES, autoApprove: true });
    const { llm } = model({
      company: CASUAL,
      person: { "first_name: Jane / full_name: Jane Doe": { first: "Jane" } },
    });
    const stats = await refreshQueue(db(), {
      niche: "sec_ria",
      templates: TEMPLATES,
      factsView: null,
      offerFacts: new Map(),
      site: null,
      senders: [SENDER],
      signatures: {},
      trackOpens: false,
      fill: makeFiller(db(), llm),
    });
    expect(stats.rerendered).toBe(1);
    const opener = (await allMessages(db())).find((m) => m.step === 0);
    expect(opener?.body).toBe(
      "Hi Jane,\n\nI've followed Assertive Staffing for a while. You place travel nurses.",
    );
  });
});
