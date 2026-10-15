/**
 * The lander's push on a Restate test environment (always replaying): `SmsForms/applied` reads
 * the one application from the site's export and steps it now. A due applicant's first text is
 * queued at once; a repeat push is a no-op; an id the site doesn't have yet waits for the pass.
 * Synthetic applicants and a fake carrier; nothing leaves.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FORM_SEQUENCES, type FormApplication } from "../../src/form.js";
import { DEFAULT_HEALTH } from "../../src/health.js";
import { FakeProvider } from "../../src/provider.js";
import { makeSmsForms, type SmsFormsService } from "../../src/restate/forms.js";
import { smsMessages, speedRuns } from "../../src/schema.js";
import { fillTemplates, notes, numbers, OPEN, POLICY, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
const provider = new FakeProvider();
const n = notes();
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));

/** The site: one old application (texts start after it) and the pushed ones. */
const apps: FormApplication[] = [];
const application = (id: number, over: Partial<FormApplication> = {}): FormApplication => ({
  id,
  ts: new Date(OPEN.getTime() - 3 * 60_000).toISOString(),
  offer: "recruiting",
  name: "dana smith",
  email: `a${id}@x.test`,
  phone: `(212) 555-01${String(id).padStart(2, "0")}`,
  sms_consent: 1,
  fit: 1,
  page: "/recruiting",
  ...over,
});
const fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const since = Number(url.searchParams.get("since"));
  const limit = Number(url.searchParams.get("limit"));
  return Response.json({ applications: apps.filter((a) => a.id > since).slice(0, limit) });
}) as typeof globalThis.fetch;

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeSmsForms({
        db: pg.db,
        provider,
        policy: POLICY,
        health: DEFAULT_HEALTH,
        live: true,
        campaignId: "camp-1",
        sequences: new Map(FORM_SEQUENCES.map((s) => [s.name, s])),
        senderName: "William",
        heldNiches: [],
        notifier: n.notifier,
        llm: null,
        site: { baseUrl: "https://wrenautomation.com", exportToken: "t", fetch },
        formCountries: ["US", "CA", "IN"],
        clock: () => OPEN,
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "speed_runs"]);
  await fillTemplates(pg.db, {
    "form-fit#1": "hi {first_name|there}, {sender} here. STOP to opt out",
    "follow-up#1": "still want a call?",
    "follow-up#2": "last one",
  });
  await numbers(pg.db, provider, ["+13125550001"]);
  apps.length = 0;
});

describe("SmsForms", () => {
  it("a push texts a due applicant now, once", async () => {
    apps.push(application(4));
    const forms = ingress().serviceClient<SmsFormsService>({ name: "SmsForms" });
    expect(await forms.applied({ application: 4 })).toMatchObject({ kind: "texted" });
    expect(await forms.applied({ application: 4 })).toEqual({ kind: "done" });
    const queued = await pg.db.select().from(smsMessages);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ state: "queued", step: 1, template: "form-fit#1" });
    const [run] = await pg.db.select().from(speedRuns);
    expect(run).toMatchObject({ subject: "site:applications:4", consent: true });
  });

  it("an application not on the site yet is left to the pass", async () => {
    const forms = ingress().serviceClient<SmsFormsService>({ name: "SmsForms" });
    expect(await forms.applied({ application: 9 })).toBeNull();
    expect(await pg.db.select().from(speedRuns)).toEqual([]);
  });

  it("an unticked box is recorded and goes no further", async () => {
    apps.push(application(5, { sms_consent: 0 }));
    const forms = ingress().serviceClient<SmsFormsService>({ name: "SmsForms" });
    expect(await forms.applied({ application: 5 })).toEqual({ kind: "no_consent" });
    expect(await pg.db.select().from(smsMessages)).toEqual([]);
  });
});
