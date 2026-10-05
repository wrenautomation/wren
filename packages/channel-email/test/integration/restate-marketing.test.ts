/**
 * Marketing through Restate: a signed signup mails one confirm link, the link confirms, and the
 * preference center's changes land as the person's own. Unsigned or forged calls move nothing.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { mayMarket, signupSig } from "@wren/core/marketing";
import { topics } from "@wren/core/schema";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Marketing, makeMarketing } from "../../src/restate/marketing.js";
import type { PlainMail } from "../../src/send/gmail.js";

const SHARED = "test-shared-secret";
const sent: PlainMail[] = [];
let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeMarketing({
        db: pg.db,
        shared: SHARED,
        site: "https://site.example",
        send: async (m) => {
          sent.push(m);
        },
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
  sent.length = 0;
  await truncate(pg.db, [
    "consent_events",
    "consents",
    "topics",
    "suppression_events",
    "suppressions",
  ]);
  await pg.db.insert(topics).values([
    {
      name: "weekly-breakdown",
      publicName: "Weekly breakdown",
      line: "A short breakdown of one automation",
      channel: "email",
      cadence: "weekly",
      public: true,
    },
    {
      name: "hidden",
      publicName: "Hidden",
      line: "Not on the page",
      channel: "email",
      cadence: "rarely",
      public: false,
    },
  ]);
});

const mk = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<Marketing>({ name: "Marketing" });
const ADDRESS = "ana@firm.example";
const signUp = (over: Record<string, string> = {}) =>
  mk().signUp({
    topic: "weekly-breakdown",
    address: ADDRESS,
    sig: signupSig(SHARED, over.topic ?? "weekly-breakdown", over.address ?? ADDRESS),
    form: "https://site.example/",
    text: "Send me the breakdown",
    textVersion: "v1",
    ip: "192.0.2.1",
    ...over,
  });
const tokenOf = (m: PlainMail | undefined) => {
  const t = m?.text.match(/\/prefs\/([^?\s]+)\?confirm=1/)?.[1];
  if (!t) throw new Error("no confirm link");
  return t;
};
const may = () =>
  mayMarket(pg.db, { channel: "email", address: ADDRESS, topic: "weekly-breakdown" });

describe("Marketing", () => {
  it("a signup mails one confirm link, and its click confirms", async () => {
    expect(await signUp()).toEqual({ ok: true });
    expect(await signUp()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Confirm: Weekly breakdown");
    const r = await mk().confirm({ token: tokenOf(sent[0]), ip: "192.0.2.1" });
    expect(r.ok).toBe(true);
    expect(r.prefs.topics).toEqual([
      expect.objectContaining({ name: "weekly-breakdown", on: true }),
    ]);
    expect(await may()).toMatchObject({ send: true });
  });

  it("refuses an unsigned or hidden-topic signup, and a forged link", async () => {
    await expect(signUp({ sig: "0".repeat(64) })).rejects.toThrow("unsigned signup");
    await expect(signUp({ topic: "hidden" })).rejects.toThrow("no such list");
    await expect(mk().prefs({ token: "x.y" })).rejects.toThrow("isn't valid");
    expect(sent).toEqual([]);
  });

  it("the preference center turns a topic off, pauses, and undoes everything", async () => {
    await signUp();
    const token = tokenOf(sent[0]);
    await mk().confirm({ token });
    const off = await mk().set({ token, change: { topic: "weekly-breakdown", on: false } });
    expect(off.prefs.named).toBe("Weekly breakdown");
    expect(off.prefs.topic).toBe("weekly-breakdown");
    expect(await may()).toMatchObject({ why: "withdrawn" });
    await mk().set({ token, change: { topic: "weekly-breakdown", on: true } });
    expect(await may()).toMatchObject({ send: true });
    await expect(mk().set({ token, change: { topic: "hidden", on: true } })).rejects.toThrow(
      "no such list",
    );
    await mk().set({ token, change: { pause: 30 } });
    expect(await may()).toMatchObject({ why: "paused" });
    await mk().set({ token, change: { pause: null } });
    const all = await mk().set({ token, change: { everything: true } });
    expect(all.prefs.everything).toBe(true);
    expect(await may()).toMatchObject({ why: "suppressed" });
    await mk().set({ token, change: { undo: all.event ?? 0 } });
    expect(await may()).toMatchObject({ send: true });
  });
});
