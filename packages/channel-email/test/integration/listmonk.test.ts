/**
 * The newsletter on Listmonk (designs/2026-10-21-esign-and-newsletter.md), through Restate on
 * Postgres with a fake mailer and a fake Listmonk. A message Listmonk posts is mailed once from the
 * consent gate, with the unsubscribe footer; a repeat of it, a withdrawn address and a stranger send
 * nothing. The hourly sync puts confirmed people on the list and takes a Listmonk unsubscribe back
 * into Wren. Synthetic data only; no network.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { giveConsent, issueSends, mayMarket, withdrawConsent } from "@wren/core/marketing";
import { topics } from "@wren/core/schema";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FetchLike } from "../../src/fetch-like.js";
import { listmonk } from "../../src/listmonk/client.js";
import {
  type ListmonkIntake,
  makeListmonkIntake,
  makeListmonkMail,
  syncAllTopics,
} from "../../src/restate/listmonk.js";
import type { PlainMail } from "../../src/send/gmail.js";

const sent: PlainMail[] = [];
let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeListmonkIntake(),
      makeListmonkMail({
        db: pg.db,
        shared: "test-shared-secret",
        site: "https://site.example",
        from: "portal@wren.example",
        postal: "1 Test Street, Testville",
        send: async (m) => {
          sent.push(m);
        },
      }),
    ],
    alwaysReplay: true,
  });
}, 240_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const TOPIC = "weekly-breakdown";
const ANA = "ana@firm.example";
beforeEach(async () => {
  sent.length = 0;
  await truncate(pg.db, [
    "marketing_sends",
    "consent_events",
    "consents",
    "topics",
    "suppression_events",
    "suppressions",
  ]);
  await pg.db.insert(topics).values({
    name: TOPIC,
    publicName: "Weekly breakdown",
    line: "One automation, broken down",
    channel: "email",
    cadence: "weekly",
    public: true,
  });
});

const confirm = (address: string, now = new Date("2026-10-01T00:00:00Z")) =>
  giveConsent(pg.db, {
    channel: "email",
    address,
    topic: TOPIC,
    source: "lander_form",
    textVersion: "v1",
    evidence: { form: "https://example.test/signup" },
    by: "subscriber",
    now,
  });

/** One message as Listmonk's postback sends it. */
const message = (o: { email: string; recipient?: string; campaign?: string; tags?: string[] }) => ({
  subject: "A new post",
  body: "Plain words and a link https://site.example/blog/a-new-post",
  content_type: "plain",
  recipients: [{ uuid: o.recipient ?? "r-1", email: o.email, name: "Ana", status: "enabled" }],
  campaign: {
    uuid: o.campaign ?? "c0ffee00-0000-4000-8000-000000000001",
    name: "A new post",
    tags: o.tags ?? [`issue:${TOPIC}:a-new-post`],
  },
});

const post = (m: ReturnType<typeof message>) =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<ListmonkIntake>({ name: "ListmonkIntake" })
    .post(m);

/** The mail goes out after the intake answers: wait for the count to settle. */
const settle = async (until: (n: number) => boolean, tries = 100) => {
  for (let i = 0; i < tries && !until(sent.length); i++)
    await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
};

describe("ListmonkIntake and ListmonkMail", () => {
  it("mails a confirmed address once, with the unsubscribe footer, and records the send", async () => {
    await confirm(ANA);
    expect(await post(message({ email: ANA }))).toEqual({ ok: true });
    await settle((n) => n >= 1);
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail?.to).toBe(ANA);
    expect(mail?.subject).toBe("A new post");
    expect(mail?.text).toContain("Plain words");
    expect(mail?.headers?.map(([k]) => k.toLowerCase())).toContain("list-unsubscribe");
    expect(await issueSends(pg.db, `${TOPIC}:a-new-post`)).toBe(1);
  });

  it("does nothing for a repeat of the same message or a second message to the same address", async () => {
    await confirm(ANA);
    await post(message({ email: ANA }));
    await settle((n) => n >= 1);
    await post(message({ email: ANA }));
    await post(message({ email: ANA, recipient: "r-2" }));
    await settle(() => false, 12);
    expect(sent).toHaveLength(1);
    expect(await issueSends(pg.db, `${TOPIC}:a-new-post`)).toBe(1);
  });

  it("sends nothing to a withdrawn address or one that never signed up", async () => {
    await confirm(ANA);
    await withdrawConsent(pg.db, { channel: "email", address: ANA, topic: TOPIC, by: "test" });
    await post(message({ email: ANA }));
    await post(message({ email: "stranger@firm.example", recipient: "r-3" }));
    await settle(() => false, 12);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a campaign that names no topic or an unknown one", async () => {
    await confirm(ANA);
    await post(message({ email: ANA, tags: [] }));
    await post(message({ email: ANA, recipient: "r-4", tags: ["issue:no-such-topic:x"] }));
    await settle(() => false, 12);
    expect(sent).toHaveLength(0);
  });

  it("files a campaign made by hand under its topic tag", async () => {
    await confirm(ANA);
    await post(message({ email: ANA, tags: [`wren-topic:${TOPIC}`] }));
    await settle((n) => n >= 1);
    expect(sent).toHaveLength(1);
    expect(await issueSends(pg.db, `${TOPIC}:a-new-post-c0ffee00`)).toBe(1);
  });
});

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe("sync", () => {
  /** A fake Listmonk with one list for the topic and one subscriber who has left it. */
  function fakeListmonk(left: { email: string; at: string }) {
    const calls: string[] = [];
    const list = { id: 7, name: "Weekly breakdown", tags: [`wren-topic:${TOPIC}`] };
    const subscribers = [
      {
        id: 1,
        email: left.email,
        name: "x",
        status: "enabled",
        updated_at: left.at,
        lists: [{ id: 7, subscription_status: "unsubscribed", subscription_updated_at: left.at }],
      },
    ];
    const fetch: FetchLike = async (url, init) => {
      const path = url.replace("https://lists.example.test", "");
      calls.push(`${init?.method ?? "GET"} ${path}`);
      const body = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
      if (path.startsWith("/api/lists")) return body({ results: [list] });
      if (path.startsWith("/api/subscribers") && (init?.method ?? "GET") === "GET")
        return body({ results: subscribers });
      return body(true);
    };
    return {
      lm: listmonk({ url: "https://lists.example.test", user: "wren", token: "t", fetch }),
      calls,
    };
  }

  it("withdraws in Wren a person who left in Listmonk after their last consent", async () => {
    await confirm(ANA);
    const { lm } = fakeListmonk({ email: ANA, at: hoursFromNow(1) });
    const out = await syncAllTopics({ db: pg.db, lm });
    expect(out.topics).toMatchObject([{ topic: TOPIC, listId: 7, withdraw: 1 }]);
    expect((await mayMarket(pg.db, { channel: "email", address: ANA, topic: TOPIC })).send).toBe(
      false,
    );
  });

  it("keeps a person who re-confirmed in Wren after leaving Listmonk", async () => {
    await confirm(ANA);
    const { lm, calls } = fakeListmonk({ email: ANA, at: hoursFromNow(-1) });
    const out = await syncAllTopics({ db: pg.db, lm });
    expect(out.topics).toMatchObject([{ withdraw: 0, add: 1 }]);
    expect(await mayMarket(pg.db, { channel: "email", address: ANA, topic: TOPIC })).toMatchObject({
      send: true,
    });
    expect(calls.some((c) => c.startsWith("PUT /api/subscribers/lists"))).toBe(true);
  });
});
