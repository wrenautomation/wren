/**
 * Adversarial cases for forwarding inside the `Reactivation` loop over a real
 * Restate: `stages.handoff` off forwards nothing, a pass forwards once, the
 * operator's notices name no contact, and a forward that keeps failing is one
 * warning. A failing test here is a bug, marked "Was a bug:".
 */
import * as restate from "@restatedev/restate-sdk";
import * as ingress from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import {
  ConsoleTransport,
  FakeVerifier,
  type LocalCheckerLike,
  TransportRefused,
} from "@wren/channel-email";
import { ingressOf } from "@wren/config";
import { clients } from "@wren/core/clients";
import type { Notifier } from "@wren/core/notify";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { makeReactivation, type Reactivation } from "../../src/loop.js";
import { setClientProfile } from "../../src/profile.js";

const SAM = "sam@acme-talent.example";
const PAT = "pat@acme.example";
const JANE = "jane@umbrella.example";
const checker: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

const standIn = (name: string) =>
  restate.object({
    name,
    handlers: {
      start: async (ctx: restate.ObjectContext) => ctx.set("running", true),
      stop: async (ctx: restate.ObjectContext) => ctx.set("running", false),
    },
  });

/** `db` whose reads throw while `broken()` says so. */
const breakable = (db: Db, broken: () => boolean): Db =>
  new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "select" && broken())
        return () => {
          throw new Error("connection refused");
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

let refusing = false;
let clientDbDown = false;
const transport = new ConsoleTransport({
  write: () => {},
  refuse: () => (refusing ? new TransportRefused("token refused", { senderLevel: true }) : null),
});
const notes: Array<{ title: string; body: string }> = [];
const notifier: Notifier = {
  name: "test",
  async notify(title, body) {
    notes.push({ title, body: body ?? "" });
    return true;
  },
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeReactivation({
        main: pg.db,
        open: () => breakable(pg.db, () => clientDbDown),
        crm: { verifier: new FakeVerifier({ authoritative: true }), checker, llm: null },
        freeVerify: false,
        transport,
        notifier,
      }),
      standIn("SendScheduler"),
      standIn("InboxScheduler"),
    ],
    alwaysReplay: true,
  });
}, 120_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

let n = 0;
let id = "";
beforeEach(async () => {
  n += 1;
  id = `fwd${n}`;
  refusing = false;
  clientDbDown = false;
  notes.length = 0;
  transport.mailbox.clear();
  await truncate(pg.db, [
    "handoffs",
    "thread_events",
    "messages",
    "enrollments",
    "crm_contacts",
    "import_errors",
    "people",
    "companies",
    "imports",
    "client_profile",
  ]);
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  const csv = [
    "ID,Name,Email,Company,Website",
    `1,Jane Doe,${JANE},Umbrella,https://umbrella.example`,
  ].join("\n");
  await runCrmImport(pg.db, new CrmCsvSource(f, "export.csv", new TextEncoder().encode(csv)));
  await setClientProfile(pg.db, {
    firm: "Acme",
    sells: "engineers",
    voice: "plain",
    recruiters: [{ name: "Pat", email: PAT }],
    defaultRecruiter: PAT,
    signature: "{name}",
  });
  const [person] = await pg.db.execute<{ id: number; company_id: number }>(
    sql`select person_id as id, company_id from crm_contacts where email = ${JANE} limit 1`,
  );
  const [enr] = await pg.db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${person?.id}, ${person?.company_id}, 'reactivation', 'reactivation', '{}'::jsonb,
      'reactivation', 'finished', 'person', ${JANE}, ${SAM})
    returning id`);
  await pg.db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values (${enr?.id}, 0, 'reactivation_opener', 'v1', ${JANE}, 'umbrella', 'Hi',
      ${JSON.stringify({ recruiter: PAT })}::jsonb, 'draft')`);
  await pg.db.execute(sql`
    insert into thread_events (enrollment_id, kind, disposition, disposition_source, from_address,
      subject, body_text, received_at)
    values (${enr?.id}, 'reply', 'interested', 'llm', ${JANE}, 'Re: umbrella', 'Yes please.', now())`);
});

const connect = () => ingress.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const loop = () => connect().objectClient<Reactivation>({ name: "Reactivation" }, id);
const addClient = (stages: Record<string, boolean>) =>
  pg.db.insert(clients).values({
    id,
    name: "Acme",
    database: `wren_client_${id}`,
    products: {
      reactivation: {
        on: true,
        senders: [{ address: SAM, name: "Sam Park" }],
        stages: { research: false, compose: false, ...stages },
      },
    },
  });
const setStages = (stages: Record<string, boolean>) =>
  pg.db.execute(sql`
    update clients set products = ${JSON.stringify({
      reactivation: {
        on: true,
        senders: [{ address: SAM, name: "Sam Park" }],
        stages: { research: false, compose: false, ...stages },
      },
    })}::jsonb where id = ${id}`);
const sent = () => transport.mailbox.get(SAM) ?? [];
const failNotes = () =>
  notes.filter((x) => x.title.includes("forward") && x.title.includes("failed"));

describe("forwarding in the loop", () => {
  it("handoff off forwards nothing; on, it forwards once and says so without names", async () => {
    await addClient({ handoff: false });
    const off = await loop().sync();
    expect(off.error).toBeNull();
    expect(off.stats?.handoff).toBeNull();
    expect(sent()).toHaveLength(0);

    await setStages({ handoff: true });
    const on = await loop().sync();
    expect(on.stats?.handoff).toMatchObject({ opened: 1, forwarded: 1, failed: 0 });
    expect(sent().map((s) => s.email.to)).toEqual([PAT]);
    const told = notes.filter((x) => x.title.includes("forwarded"));
    expect(told).toHaveLength(1);
    expect(`${told[0]?.title}\n${told[0]?.body}`).not.toMatch(/jane|doe|umbrella/i);

    const again = await loop().sync();
    expect(again.stats?.handoff).toMatchObject({ opened: 0, forwarded: 0 });
    expect(sent()).toHaveLength(1);
    expect(notes.filter((x) => x.title.includes("forwarded"))).toHaveLength(1);
  });

  it("a forward that fails every pass is one warning, and the pass itself succeeds", async () => {
    await addClient({});
    refusing = true;
    for (let i = 0; i < 3; i++) {
      const out = await loop().sync();
      expect(out.error).toBeNull();
      expect(out.stats?.handoff).toMatchObject({ failed: 1 });
    }
    expect(failNotes()).toHaveLength(1);
    expect(failNotes()[0]?.body).not.toMatch(/jane|doe|umbrella/i);
    refusing = false;
    const ok = await loop().sync();
    expect(ok.stats?.handoff).toMatchObject({ forwarded: 1, failed: 0 });
    expect(sent()).toHaveLength(1);
  });

  it("a pass that errors in between doesn't repeat the forward-failed warning", async () => {
    // Was a bug: tellHandoffs (loop.ts:249) warns when `previous.stats.handoff.failed`
    // is 0. A pass whose body throws (client DB blip) stores `handoff: null`
    // (loop.ts:218-222), so the next pass with the same still-failing forward
    // warns again. A flaky DB turns "one message" into one per blip, on top of
    // the pass's own failed/recovered notices. Fix: keep the failing state in
    // its own key (e.g. ctx.set("forwardFailing", true)) instead of reading it
    // off the last pass's stats.
    await addClient({});
    refusing = true;
    await loop().sync();
    expect(failNotes()).toHaveLength(1);
    clientDbDown = true;
    const down = await loop().sync();
    expect(down.error).not.toBeNull();
    clientDbDown = false;
    const back = await loop().sync();
    expect(back.stats?.handoff).toMatchObject({ failed: 1 });
    expect(failNotes()).toHaveLength(1);
  });
});
