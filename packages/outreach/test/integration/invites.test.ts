/**
 * LinkedIn invites on Postgres with a fake channel and a fixed clock: people → top-up (held
 * niche, declined firm, no page left out; engaged, then senior, then biggest first) proposes
 * invites → nothing sends until approved → the tick sends and the contact waits → the sweep finds
 * the accept and withdraws the stale → the month's notes run out. Skip ends the person for good.
 */

import { setWrenSettings } from "@wren/core/clients";
import { fakeOutreachChannel } from "@wren/core/outreach";
import { companies, people } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addAccount, setAccountState } from "../../src/accounts.js";
import { contactById } from "../../src/contacts.js";
import {
  approveInvites,
  INVITE_SEQUENCE,
  type InviteSettings,
  inviteSettings,
  invitesSettingsSchema,
  peopleForInvites,
  proposedInvites,
  skipInvites,
  sweepInvites,
  topUp,
  whyOf,
} from "../../src/invites.js";
import { DEFAULT_POLICY, type ReachPolicy } from "../../src/policy.js";
import { inviteRecord } from "../../src/records.js";
import { type ReachAccount, reachContacts, reachMessages } from "../../src/schema.js";
import { CONNECT_NOTE, REACH_SEQUENCES, slotsOf } from "../../src/sequences.js";
import { setTemplate } from "../../src/store.js";
import { tick } from "../../src/tick.js";

const TABLES = [
  "reach_messages",
  "reach_contacts",
  "reach_accounts",
  "templates",
  "template_versions",
  "social_activity",
  "findings",
  "enrichments",
  "people",
  "companies",
  "wren_settings",
];
const POLICY: ReachPolicy = { ...DEFAULT_POLICY, gapSeconds: 0 };
// Thursday 14:00 New York.
const OPEN = new Date("2026-10-01T18:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(OPEN.getTime() + days * DAY);
const KEY = "linkedin@wren";

let pg: TestPostgres;
const db = () => pg.db;
let fake: ReturnType<typeof fakeOutreachChannel>;
let acct: ReachAccount;
const SETTINGS: InviteSettings = invitesSettingsSchema.parse({ account: KEY });

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  fake = fakeOutreachChannel("linkedin", { account: KEY, connects: true });
  const a = await addAccount(db(), { platform: "linkedin", account: KEY, now: at(-40) });
  acct = await setAccountState(db(), a.id, "active", { reason: null, now: at(-40) });
});

/**
 * A firm and one person at it; `vanity` null = no LinkedIn page. `team`: the agency listing's
 * size; `employees`: the LinkedIn page's, as Exa's cache read it; `ppp`: PPP jobs reported.
 */
async function person(
  vanity: string | null,
  o: {
    title?: string;
    niche?: string;
    declined?: boolean;
    team?: string;
    employees?: string;
    ppp?: number;
  } = {},
) {
  const [co] = await db()
    .insert(companies)
    .values({
      domain: `${vanity ?? Math.random().toString(36).slice(2)}.example`,
      name: `${vanity} Co`,
      niche: o.niche ?? "recruiting",
      declineReason: o.declined ? "chain" : null,
      raw: o.team ? { "agency.team_size": o.team } : null,
    })
    .returning();
  const companyId = (co as { id: number }).id;
  if (o.employees)
    await db().execute(sql`insert into findings (kind, company_id, fact_key, value, confidence, via)
      values ('profile', ${companyId}, ${`profile:${companyId}`}, ${JSON.stringify({ employees: o.employees })}::jsonb, 0.9, 'exa-cache')`);
  if (o.ppp !== undefined)
    await db().execute(sql`insert into enrichments (kind, model, prompt_version, output, company_id)
      values ('firmographics', 'ppp-foia', 'v1', ${JSON.stringify({ jobs_reported: o.ppp })}::jsonb, ${companyId})`);
  const [p] = await db()
    .insert(people)
    .values({
      companyId: (co as { id: number }).id,
      fullName: `${(vanity ?? "nobody").replace(/^./, (c) => c.toUpperCase()).replace(/-.*$/, "")} Test`,
      title: o.title ?? "Owner",
      isCompliance: false,
      origin: "website",
      originRef: "test",
      raw: {},
      linkedinUrl: vanity ? `https://www.linkedin.com/in/${vanity}/` : null,
    })
    .returning();
  return p as { id: number };
}

const top = (settings = SETTINGS, now = OPEN) =>
  topUp(db(), {
    settings,
    account: acct,
    policy: POLICY,
    sequences: REACH_SEQUENCES,
    sender: "William",
    held: ["ria"],
    now,
  });
const tickAt = (now: Date) =>
  tick(db(), {
    channelFor: () => fake,
    policy: POLICY,
    sequences: REACH_SEQUENCES,
    sender: "William",
    live: true,
    now,
  });
const contactOf = async (handle: string) => {
  const [c] = await db().select().from(reachContacts).where(eq(reachContacts.handle, handle));
  if (!c) throw new Error(handle);
  return c;
};
/** Someone on LinkedIn who did `kind` on our page. */
const engaged = (vanity: string, kind: "reaction" | "mention" | "follow", actor = vanity) =>
  db().execute(sql`insert into social_activity (platform, kind, ref, actor, actor_url, text, at, raw)
    values ('linkedin', ${kind}, ${`${kind}:${vanity}`}, ${actor},
      ${`https://www.linkedin.com/in/${vanity}/`}, '', ${OPEN.toISOString()}, '{}'::jsonb)`);
const proposedIds = async () => (await proposedInvites(db())).map((p) => p.id);
const statuses = async () =>
  Object.fromEntries(
    (
      (await db().execute(sql`select handle, status from reach_invites`)) as unknown as Array<{
        handle: string;
        status: string;
      }>
    ).map((r) => [r.handle, r.status]),
  );

describe("linkedin invites", () => {
  it("settings read as off until an account is named", async () => {
    expect((await inviteSettings(db())).account).toBe("");
    await setWrenSettings(db(), "linkedin.invites", { account: KEY, perDay: 10 }, "test");
    expect(await inviteSettings(db())).toMatchObject({ account: KEY, perDay: 10 });
  });

  it("picks people with a page, senior first, never a held niche or a declined firm", async () => {
    const analyst = await person("bob-d", { title: "Analyst", niche: "agencies" });
    const founder = await person("alice-a", { title: "Founder & CEO" });
    await person("carol-b", { niche: "ria" });
    await person("dan-c", { declined: true });
    await person(null);
    // Decision-makers only by default: the analyst is left out.
    const all = await peopleForInvites(db(), SETTINGS, ["ria"], 10);
    expect(all.map((p) => p.personId)).toEqual([founder.id]);
    const anyone = await peopleForInvites(db(), { decisionMakers: false }, ["ria"], 10);
    expect(anyone.map((p) => p.personId)).toEqual([founder.id, analyst.id]);
    const founders = await peopleForInvites(db(), { niches: [], titles: ["founder"] }, [], 10);
    expect(founders.map((p) => p.vanity)).toEqual(["alice-a"]);
    const agencies = await peopleForInvites(
      db(),
      { niches: ["agencies"], titles: [], decisionMakers: false },
      [],
      10,
    );
    expect(agencies.map((p) => p.vanity)).toEqual(["bob-d"]);
  });

  it("ranks engaged first, then title tier, then firm size; filters by size", async () => {
    await person("vp-small", { title: "Vice President, Sales", team: "10 - 49" });
    await person("ceo-big", { title: "CEO", employees: "1,001-5,000" });
    await person("owner-mid", { title: "Owner", ppp: 120 });
    await person("owner-unknown", { title: "Owner" });
    await person("dir-big", { title: "Director of Ops", team: "1,000 - 9,999" });
    // An engaged analyst: past the title filter, and first.
    await person("fan-analyst", { title: "Analyst" });
    await engaged("fan-analyst", "reaction");
    // Engaged, not in People.
    await engaged("stranger-x", "follow", "Stranger X");

    const all = await peopleForInvites(db(), SETTINGS, [], 20);
    expect(all.map((p) => p.vanity)).toEqual([
      "fan-analyst",
      "stranger-x",
      "ceo-big",
      "owner-mid",
      "owner-unknown",
      "dir-big",
      "vp-small",
    ]);
    expect(all.find((p) => p.vanity === "ceo-big")).toMatchObject({
      employees: 5000,
      size: "1,001-5,000",
      tier: 1,
    });
    expect(all.find((p) => p.vanity === "owner-mid")?.employees).toBe(120);
    expect(all.find((p) => p.vanity === "stranger-x")).toMatchObject({
      personId: null,
      name: "Stranger X",
      engaged: "follow",
    });

    // A floor of 100: the small firm drops; unknown stays unless knownSizeOnly.
    const big = await peopleForInvites(db(), { minEmployees: 100 }, [], 20);
    expect(big.map((p) => p.vanity)).toEqual([
      "fan-analyst",
      "stranger-x",
      "ceo-big",
      "owner-mid",
      "owner-unknown",
      "dir-big",
    ]);
    const known = await peopleForInvites(
      db(),
      { minEmployees: 100, knownSizeOnly: true, engaged: false },
      [],
      20,
    );
    expect(known.map((p) => p.vanity)).toEqual(["ceo-big", "owner-mid", "dir-big"]);

    const why = (v: string) => {
      const t = all.find((p) => p.vanity === v);
      if (!t) throw new Error(v);
      return whyOf(t).why;
    };
    expect(why("ceo-big")).toBe("CEO at ceo-big Co, 1,001-5,000 people.");
    expect(why("fan-analyst")).toBe("Analyst at fan-analyst Co. Reacted to our post.");
    expect(why("stranger-x")).toBe("Follows us.");
  });

  it("proposes, sends nothing until approved, and a skip ends the person", async () => {
    await person("alice-a", { title: "Founder", team: "50 - 249" });
    await person("bob-d", { title: "Director" });
    const first = await top();
    expect(first).toMatchObject({ target: 20, queued: 0, enrolled: 2 });
    expect(await statuses()).toEqual({ "alice-a": "proposed", "bob-d": "proposed" });
    // Proposed counts toward the day: a second top-up adds nothing.
    expect(await top()).toMatchObject({ queued: 2, enrolled: 0 });
    const a = await contactOf("alice-a");
    expect(a.fit).toMatchObject({ why: "Founder at alice-a Co, 50-249 people.", employees: 249 });

    // The tick holds proposed invites.
    await tickAt(OPEN);
    expect(fake.sent).toEqual([]);

    // The CLI's list and the Invites page show both, with the why.
    expect((await proposedInvites(db())).map((p) => [p.id, p.fit?.why])).toEqual([
      [a.id, "Founder at alice-a Co, 50-249 people."],
      [(await contactOf("bob-d")).id, "Director at bob-d Co."],
    ]);
    const rows = (await inviteRecord.rows?.(db())) ?? [];
    expect(rows.map((r) => [r.who, r.status, r.why])).toContainEqual([
      "Alice Test",
      "proposed",
      "Founder at alice-a Co, 50-249 people.",
    ]);

    const b = await contactOf("bob-d");
    expect(await skipInvites(db(), [b.id], OPEN)).toEqual([b.id]);
    expect(await contactById(db(), b.id)).toMatchObject({
      state: "finished",
      stateReason: "skipped in To approve",
    });
    expect(await approveInvites(db(), [a.id, b.id], OPEN)).toEqual([a.id]);
    expect(await proposedIds()).toEqual([]);
    await tickAt(OPEN);
    expect(fake.sent.map((s) => [s.kind, s.handle])).toEqual([["connect", "alice-a"]]);
    // Bob is never proposed again.
    await top(SETTINGS, at(1));
    expect(await proposedIds()).toEqual([]);
  });

  it("tops up, sends invites, finds the accept, withdraws the stale", async () => {
    const alice = await person("alice-a", { title: "Founder" });
    await person("bob-d", { niche: "agencies" });
    const first = await top();
    expect(first).toMatchObject({ target: 20, queued: 0, added: 2, enrolled: 2 });
    const a = await contactOf("alice-a");
    expect(a).toMatchObject({ personId: alice.id, foundIn: "people", sequence: INVITE_SEQUENCE });
    expect(await top()).toMatchObject({ queued: 2, enrolled: 0 });
    await approveInvites(db(), await proposedIds(), OPEN);
    expect(await statuses()).toEqual({ "alice-a": "queued", "bob-d": "queued" });

    await tickAt(OPEN);
    await tickAt(OPEN);
    expect(fake.sent.map((s) => [s.kind, s.handle, s.text])).toEqual([
      ["connect", "alice-a", null],
      ["connect", "bob-d", null],
    ]);
    // Invite only: the contact waits, nothing else is queued.
    expect((await contactById(db(), a.id)).state).toBe("enrolled");
    expect(await statuses()).toEqual({ "alice-a": "pending", "bob-d": "pending" });

    fake.relationships.set("alice-a", "connected");
    const swept = await sweepInvites(db(), fake, acct, SETTINGS, at(1));
    expect(swept).toMatchObject({ accepted: [a.id], withdrawn: 0 });
    expect((await contactById(db(), a.id)).state).toBe("connected");

    // Not stale yet at 20 days; withdrawn past 21.
    expect((await sweepInvites(db(), fake, acct, SETTINGS, at(20))).withdrawn).toBe(0);
    expect((await sweepInvites(db(), fake, acct, SETTINGS, at(22))).withdrawn).toBe(1);
    const bob = await contactOf("bob-d");
    expect(bob).toMatchObject({
      state: "unreachable",
      stateReason: "invite withdrawn after 21 days",
    });
    expect(bob.withdrawnAt).not.toBeNull();
    expect(await statuses()).toEqual({ "alice-a": "accepted", "bob-d": "withdrawn" });
    const rows = (await inviteRecord.rows?.(db())) ?? [];
    expect(rows.map((r) => [r.who, r.status])).toEqual([
      ["Bob Test", "withdrawn"],
      ["Alice Test", "accepted"],
    ]);
  });

  it("an invite goes bare once the month's notes are spent", async () => {
    await setTemplate(
      db(),
      { slots: slotsOf(REACH_SEQUENCES.values()), sender: "William" },
      { key: CONNECT_NOTE, body: "Hi {first_name|there}.", by: "test" },
    );
    await person("alice-a");
    await person("bob-d", { niche: "agencies" });
    await top();
    await approveInvites(db(), await proposedIds(), OPEN);
    const one: ReachPolicy = { ...POLICY, linkedin: { ...POLICY.linkedin, notesPerMonth: 1 } };
    const send = () =>
      tick(db(), {
        channelFor: () => fake,
        policy: one,
        sequences: REACH_SEQUENCES,
        sender: "William",
        live: true,
        now: OPEN,
      });
    await send();
    await send();
    expect(fake.sent.map((s) => s.text)).toEqual(["Hi Alice.", null]);
    const bare = await db()
      .select({ body: reachMessages.body })
      .from(reachMessages)
      .where(eq(reachMessages.kind, "connect"));
    expect(bare.map((r) => r.body).sort()).toEqual(["", "Hi Alice."]);
  });
});
