/**
 * A client's own Inbox (designs/2026-10-07-inbox-reply.md): its logins reply, ask, suggest, note,
 * assign, close and snooze on their own threads through `MarketingConsole`, which runs InboxDesk
 * on the client's database. Its access grants decide each step, its approver decides whether a
 * reply waits. Two clients and Wren never mix. Synthetic clients and threads only.
 */
import type { Context } from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, addMember, updateClient } from "@wren/core/clients";
import { addGrant } from "@wren/core/grants";
import type { MailSender } from "@wren/core/mailbox";
import { whoIs } from "@wren/core/portal";
import { startTestRestate } from "@wren/core/testing";
import { setManaged } from "@wren/core/vendors";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { inboxMentionsOf } from "@wren/notes/inbox";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conversationOf, type ReplySender } from "../../src/inbox/index.js";
import { CONTENT_RECORDS } from "../../src/records.js";
import { makeInboxDesk } from "../../src/restate/inbox-desk.js";
import { type MailReply, makeMailReply } from "../../src/restate/mail-reply.js";
import {
  type MarketingConsoleService,
  makeMarketingConsole,
  marketingConsoleApi,
} from "../../src/restate/marketing-console.js";
import { askedReplyRecord, inboxRecord } from "../../src/social/records.js";
import { type InboxSeed, seedInbox } from "../inbox-seed.js";

/** What the fake channels sent, and for which client. */
const sent: { client: string | null; channel: string; id: number; body: string }[] = [];
const fake = (ctx: Context, client: string | null): ReplySender => {
  const push = (channel: string) => async (id: number, body: string) => {
    await ctx.run(`send ${channel}`, async () => {
      sent.push({ client, channel, id, body });
    });
  };
  return {
    dm: push("dm"),
    text: push("text"),
    comment: push("comment"),
    invite: push("invite"),
    email: push("email"),
    thread: push("thread"),
    chat: push("chat"),
    // Mail goes the real way: MailReply, over a fake mailbox.
    mail: async (mailId, body) => {
      if (!client) throw new Error("no client");
      await ctx.serviceClient<MailReply>({ name: "MailReply" }).send({ client, mailId, body });
    },
  };
};
/** What the fake mailboxes sent: from, to, the thread and the words. */
const mailed: { from: string; to: string; thread: string; body: string; ours: string }[] = [];
/** A fake provider that answers "refused" for this mailbox, as a 403 would. */
let refusing: string | null = null;
/** The real check's shape: a mailbox not connected is "Needs setup". */
const fakeSender = async (client: string, address: string): Promise<MailSender> => {
  const [c] = (await pg.db.execute(sql`select mc.state from mail_connections mc
    join client_accounts a on a.id = mc.account_id
    where a.client = ${client} and mc.address = ${address}`)) as unknown as { state: string }[];
  if (c?.state !== "connected")
    throw Object.assign(new Error(`Needs setup: ${address} isn't connected to send.`), {
      name: "MailRefusal",
    });
  return {
    address,
    reply: async (to, body, ours) => {
      if (refusing === address)
        throw Object.assign(new Error("403: Insufficient Permission"), {
          name: "MailApiError",
          status: 403,
        });
      mailed.push({ from: address, to: to.to, thread: to.threadId, body, ours });
      return { id: `g-${mailed.length}`, threadId: to.threadId };
    },
  };
};
const prompts: string[] = [];
const llm = new FakeLlm({
  respond: (prompt, system) => {
    prompts.push(`${system ?? ""}\n${prompt}`);
    return JSON.stringify({ draft: "Happy to help." });
  },
});

const ADMIN = "ada@wren.example.test";
const AMY = "amy@kappa.example.test"; // kappa's owner: acts, can't send
const BO = "bo@kappa.example.test"; // kappa's member with a send grant
const CY = "cy@kappa.example.test"; // kappa's viewer, texts only
const LEE = "lee@lambda.example.test"; // lambda's owner

let pg: TestPostgres;
let env: RestateTestEnvironment;
let kappa: Db;
let lambda: Db;
let k: InboxSeed;
let l: InboxSeed;
let w: InboxSeed;
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const records = [...CONTENT_RECORDS, inboxRecord, askedReplyRecord];
const products = { "marketing.stats": {} };

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "kappa", name: "Kappa", products });
  await addClient(pg.db, pg.url, { id: "lambda", name: "Lambda", products });
  await pg.db.execute(sql`insert into operators (email, role) values (${ADMIN}, 'admin')`);
  await addMember(pg.db, "kappa", AMY, { role: "owner" });
  await addMember(pg.db, "kappa", BO, { role: "member" });
  await addMember(pg.db, "kappa", CY, { role: "viewer" });
  await addMember(pg.db, "lambda", LEE, { role: "owner" });
  const admin = await whoIs(pg.db, { email: ADMIN });
  await addGrant(pg.db, admin, ADMIN, { email: BO, client: "kappa", verbs: ["effect"] });
  await addGrant(pg.db, admin, ADMIN, {
    email: CY,
    client: "kappa",
    verbs: ["act"],
    apps: ["marketing"],
    channels: ["sms"],
  });
  await setManaged(pg.db, {
    client: "kappa",
    vendor: "models",
    perDay: 100,
    capCents: 500,
    by: "test",
  });
  kappa = open("kappa");
  lambda = open("lambda");
  k = await seedInbox(kappa);
  l = await seedInbox(lambda);
  w = await seedInbox(pg.db);
  env = await startTestRestate({
    services: [
      makeInboxDesk({ db: pg.db, clientDb: open, llm, senderName: "Will", channels: fake }),
      makeMarketingConsole({ db: pg.db, open: (c) => open(c.id), records }),
      makeMailReply({ main: pg.db, clientDb: open, sender: fakeSender }),
    ],
    disableRetries: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
/** What a test changes: replies, kept status, notes and mentions. Contacts are seeded once. */
const KEPT = ["note_mentions", "inbox_notes", "inbox_threads", "inbox_replies"];
beforeEach(async () => {
  for (const db of [pg.db, kappa, lambda])
    for (const t of KEPT) await db.execute(sql.raw(`delete from "${t}"`));
  await pg.db.execute(sql`delete from client_accounts where site = 'social'`);
  await updateClient(pg.db, "kappa", { approver: "client", sends: ["follow_up"] });
  sent.length = 0;
  prompts.length = 0;
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const svc = () => ingress().serviceClient<MarketingConsoleService>({ name: "MarketingConsole" });
const desk = () => ingress().serviceClient<ReturnType<typeof makeInboxDesk>>({ name: "InboxDesk" });
const api = () => marketingConsoleApi({ db: pg.db, open: (c) => open(c.id), records });
const as = (email: string, client = "kappa") => ({ viewer: { email }, client });
const text = (s: InboxSeed) => ({
  thread: `text:${s.smsId}`,
  channel: "text" as const,
  target: String(s.smsId),
});
const statusOf = async (db: Db, id: string) =>
  ((await inboxRecord.rows?.(db)) ?? []).find((r) => r.id === id)?.status;

describe("a client's own threads", () => {
  it("lists its Inbox from its own database; another client's login can't", async () => {
    const page = await api().recordsList({ ...as(AMY), record: "marketing.inbox" });
    expect(page.total).toBeGreaterThan(0);
    await expect(
      api().recordsList({ ...as(LEE), record: "marketing.inbox" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("an owner without send rights gets Ask to send, in its own To approve", async () => {
    const out = await svc().inboxReply({ ...as(AMY), ...text(k), body: "We can do Spanish." });
    expect(out).toMatchObject({
      sent: false,
      why: "You can't send. Someone who can says yes.",
    });
    expect(sent).toEqual([]);
    const waiting = (await askedReplyRecord.rows?.(kappa)) ?? [];
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ platform: "sms", account: AMY, state: "waiting" });
    expect(await askedReplyRecord.rows?.(lambda)).toEqual([]);
    expect(await askedReplyRecord.rows?.(pg.db)).toEqual([]);
  });

  it("a member with a send grant sends when the client approves its own", async () => {
    const out = await svc().inboxReply({ ...as(BO), ...text(k), body: "We can do Spanish." });
    expect(out).toEqual({ sent: true, asked: null, why: null });
    expect(sent).toEqual([
      { client: "kappa", channel: "text", id: k.smsId, body: "We can do Spanish." },
    ]);
  });

  it("the same member asks when Wren approves this client's sends", async () => {
    await updateClient(pg.db, "kappa", { approver: "wren" });
    const out = await svc().inboxReply({ ...as(BO), ...text(k), body: "We can do Spanish." });
    expect(out).toMatchObject({ sent: false, why: "Wren approves these sends." });
    expect(sent).toEqual([]);
  });

  it("an asked reply: the client's sender says yes and it goes", async () => {
    const { asked } = await svc().inboxAsk({ ...as(AMY), ...text(k), body: "Yes, Spanish works." });
    expect(asked).toBeTypeOf("number");
    await expect(svc().inboxApprove({ ...as(AMY), id: asked as number })).rejects.toThrow();
    await svc().inboxApprove({ ...as(BO), id: asked as number });
    expect(sent).toEqual([
      { client: "kappa", channel: "text", id: k.smsId, body: "Yes, Spanish works." },
    ]);
  });

  it("suggests signed by the client, on its own models gate", async () => {
    const { text: words } = await svc().inboxSuggest({ ...as(AMY), ...text(k) });
    expect(words).toBe("Happy to help.");
    expect(prompts.join("\n")).toContain("You are Kappa");
    expect(prompts.join("\n")).not.toContain("You are Will");
    // Lambda has no models gate: nothing is asked.
    prompts.length = 0;
    await expect(svc().inboxSuggest({ ...as(LEE, "lambda"), ...text(l) })).rejects.toThrow(
      /models: /,
    );
    expect(prompts).toEqual([]);
  });

  it("notes mention the client's teammates only; assign, close, snooze and wake", async () => {
    const id = `text:${k.smsId}`;
    const out = await svc().inboxNote({
      ...as(AMY),
      thread: id,
      body: `@${BO} can you take this? @${LEE} @stranger@else.example.test`,
    });
    expect(out.mentioned).toEqual([BO]);
    expect((await inboxMentionsOf(kappa, BO)).map((m) => m.thread)).toEqual([id]);
    expect(await inboxMentionsOf(pg.db, BO)).toEqual([]);
    await svc().inboxAssign({ ...as(AMY), thread: id, assignee: BO });
    await expect(svc().inboxAssign({ ...as(AMY), thread: id, assignee: LEE })).rejects.toThrow(
      /not on the team/,
    );
    await svc().inboxTake({ ...as(AMY), thread: id });
    await svc().inboxSnooze({
      ...as(AMY),
      thread: id,
      until: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(await statusOf(kappa, id)).toBe("snoozed");
    await svc().inboxSnooze({ ...as(AMY), thread: id, until: null });
    expect(await statusOf(kappa, id)).toBe("open");
    await svc().inboxStatus({ ...as(AMY), thread: id, status: "closed" });
    expect(await statusOf(kappa, id)).toBe("closed");
    expect(await statusOf(lambda, `text:${l.smsId}`)).toBe("open");
  });

  it("a texts-only grant works texts, not email", async () => {
    await svc().inboxNote({ ...as(CY), thread: `text:${k.smsId}`, body: "on it" });
    await expect(
      svc().inboxNote({ ...as(CY), thread: `reply:${k.replyId}`, body: "on it" }),
    ).rejects.toThrow(/can't do that here/);
  });

  it("a viewer can't change anything", async () => {
    await expect(
      svc().inboxStatus({ ...as(CY), thread: `reply:${k.replyId}`, status: "closed" }),
    ).rejects.toThrow();
  });
});

/** Kappa's own YouTube channel, connected or broken: a synthetic row, no token. */
async function connectYoutube(state: "connected" | "broken" = "connected") {
  const [a] = (await pg.db.execute(sql`insert into client_accounts (client, site, ref, created_by)
    values ('kappa', 'social', ${`youtube:UC-test-${state}`}, 'test') returning id`)) as unknown as {
    id: number;
  }[];
  await pg.db.execute(sql`insert into social_connections (client, platform, account_id,
      external_id, scopes, token_ref, state, by)
    values ('kappa', 'youtube', ${a?.id}, ${`UC-test-${state}`}, 'youtube.force-ssl',
      'ks_test', ${state}, 'test')`);
}
const comment = (s: InboxSeed) => ({
  thread: `comment:${s.commentId}`,
  channel: "comment" as const,
  target: String(s.commentId),
});
const replyOf = async (thread: string, email = BO) => {
  const out = await api().recordsGet({ ...as(email), record: "marketing.inbox", id: thread });
  const c = (out.detail as { conversation: Awaited<ReturnType<typeof conversationOf>> })
    .conversation;
  return c?.options.find((o) => o.own);
};

describe("a client's DMs and comments, on its own accounts", () => {
  beforeEach(async () => {
    await updateClient(pg.db, "kappa", { sends: ["follow_up", "content.posting"] });
  });

  it("no connected account: the box says so and points at Account → Social; nothing goes", async () => {
    expect(await replyOf(`comment:${k.commentId}`)).toMatchObject({
      off: "No YouTube channel account connected. Replies go out on your own account.",
      fix: "social",
    });
    await expect(
      svc().inboxReply({ ...as(BO), ...comment(k), body: "Yes it does." }),
    ).rejects.toThrow(/No YouTube channel account connected/);
    await expect(
      svc().inboxAsk({ ...as(AMY), ...comment(k), body: "Yes it does." }),
    ).rejects.toThrow(/No YouTube channel account connected/);
    expect(sent).toEqual([]);
    expect(await askedReplyRecord.rows?.(kappa)).toEqual([]);
  });

  it("LinkedIn DMs: not available yet, with why", async () => {
    expect(await replyOf(`dm:${k.reachId}`)).toMatchObject({
      off: "Not available yet. LinkedIn has no messaging API.",
      fix: null,
    });
    await expect(
      svc().inboxReply({
        ...as(BO),
        thread: `dm:${k.reachId}`,
        channel: "dm",
        target: String(k.reachId),
        body: "hi",
      }),
    ).rejects.toThrow(/LinkedIn has no messaging API/);
    expect(sent).toEqual([]);
  });

  it("connected: sends when the client approves its own, asks when Wren approves", async () => {
    await connectYoutube();
    expect(await replyOf(`comment:${k.commentId}`)).toMatchObject({ off: null });
    const out = await svc().inboxReply({ ...as(BO), ...comment(k), body: "Yes it does." });
    expect(out).toEqual({ sent: true, asked: null, why: null });
    expect(sent).toEqual([
      { client: "kappa", channel: "comment", id: k.commentId, body: "Yes it does." },
    ]);
    sent.length = 0;
    await updateClient(pg.db, "kappa", { approver: "wren" });
    const asked = await svc().inboxReply({ ...as(BO), ...comment(k), body: "Two trucks is fine." });
    expect(asked).toMatchObject({ sent: false, why: "Wren approves these sends." });
    expect(sent).toEqual([]);
    expect((await askedReplyRecord.rows?.(kappa))?.[0]).toMatchObject({ kind: "comment" });
    await svc().inboxApprove({ ...as(ADMIN), id: asked.asked as number });
    expect(sent).toEqual([
      { client: "kappa", channel: "comment", id: k.commentId, body: "Two trucks is fine." },
    ]);
  });

  it("an asked reply whose account broke since waits; Approve says why", async () => {
    await connectYoutube();
    const { asked } = await svc().inboxAsk({ ...as(AMY), ...comment(k), body: "Yes." });
    await pg.db.execute(sql`update social_connections set state = 'broken'`);
    expect(await replyOf(`comment:${k.commentId}`)).toMatchObject({
      off: "Your YouTube channel account needs connecting again.",
      fix: "social",
    });
    await expect(svc().inboxApprove({ ...as(BO), id: asked as number })).rejects.toThrow(
      /needs connecting again/,
    );
    expect(sent).toEqual([]);
    expect((await askedReplyRecord.rows?.(kappa))?.[0]).toMatchObject({ state: "waiting" });
  });

  it("Wren's own comment threads answer as before", async () => {
    await desk().reply({ ...comment(w), body: "Thanks!", viewer: { email: ADMIN } });
    expect(sent).toEqual([{ client: null, channel: "comment", id: w.commentId, body: "Thanks!" }]);
  });
});

const FRONT = "front@kappa.example.test";
const BILLING = "billing@kappa.example.test";
/** Kappa's mailbox, connected to send (a synthetic row, no token). */
async function connectMailbox(address: string, state: "connected" | "broken" = "connected") {
  const [a] = (await pg.db.execute(sql`insert into client_accounts (client, site, ref, role,
      created_by)
    values ('kappa', 'mailbox', ${address}, 'read', 'test') returning id`)) as unknown as {
    id: number;
  }[];
  await pg.db.execute(sql`insert into mail_connections (account_id, provider, address, scopes,
      access, token_name, state, by)
    values (${a?.id}, 'google', ${address}, 'openid email gmail.send gmail.readonly', 'read',
      'ks_test', ${state}, 'test')`);
}

describe("a client's mail, answered through its own mailbox", () => {
  let front: number;
  let billing: number;
  const mail = (id: number) => ({
    thread: `mail:${id}`,
    channel: "email" as const,
    target: `mail:${id}`,
  });
  beforeAll(async () => {
    const rows = (await kappa.execute(sql`insert into watch.mail (mailbox, message_id, thread_id,
        from_name, from_address, subject, summary, verdict, at, reader)
      values
        (${FRONT}, 'gm-1', 'gt-1', 'Lee Park', 'lee@patient.example.test', 'Quote for a crown?',
          'Asks what a crown costs.', 'show', '2026-10-01T09:00:00Z', 'mail'),
        (${BILLING}, 'gm-2', 'gt-2', 'Sam Ortiz', 'sam@patient.example.test', 'Invoice',
          'Charged twice.', 'show', '2026-10-01T10:00:00Z', 'mail')
      returning id`)) as unknown as { id: number }[];
    front = Number(rows[0]?.id);
    billing = Number(rows[1]?.id);
  });
  beforeEach(async () => {
    await kappa.execute(sql`delete from watch.mail_sent`);
    await pg.db.execute(sql`delete from client_accounts where site = 'mailbox'`);
    await connectMailbox(FRONT);
    await updateClient(pg.db, "kappa", { sends: ["mail.triage"] });
    mailed.length = 0;
    refusing = null;
  });

  it("shows the thread and offers Email from the mailbox it came to", async () => {
    const c = await conversationOf(kappa, `mail:${front}`);
    expect(c?.who).toBe("Lee Park");
    expect(c?.entries).toMatchObject([
      { channel: "email", direction: "in", who: "Lee Park", subject: "Quote for a crown?" },
    ]);
    expect(await replyOf(`mail:${front}`)).toMatchObject({
      channel: "email",
      target: `mail:${front}`,
      label: "Email lee@patient.example.test",
      from: FRONT,
      off: null,
    });
  });

  it("sends through the mailbox, in its thread, and shows ours in the timeline", async () => {
    const out = await svc().inboxReply({ ...as(BO), ...mail(front), body: "A crown is $1,200." });
    expect(out).toEqual({ sent: true, asked: null, why: null });
    expect(mailed).toMatchObject([
      { from: FRONT, to: "lee@patient.example.test", thread: "gt-1", body: "A crown is $1,200." },
    ]);
    expect(mailed[0]?.ours).toMatch(/^<[0-9a-f]{32}@kappa\.example\.test>$/);
    const c = await conversationOf(kappa, `mail:${front}`);
    expect(c?.entries.at(-1)).toMatchObject({
      channel: "email",
      direction: "out",
      who: FRONT,
      body: "A crown is $1,200.",
      state: "sent",
    });
    expect(await statusOf(kappa, `mail:${front}`)).toBe("waiting");
  });

  it("waits in To approve when the approver says so; a yes sends it", async () => {
    await updateClient(pg.db, "kappa", { approver: "wren" });
    const out = await svc().inboxReply({ ...as(BO), ...mail(front), body: "Saturday works." });
    expect(out).toMatchObject({ sent: false, why: "Wren approves these sends." });
    expect(mailed).toEqual([]);
    expect((await askedReplyRecord.rows?.(kappa))?.[0]).toMatchObject({ state: "waiting" });
    await svc().inboxApprove({ ...as(ADMIN), id: out.asked as number });
    expect(mailed).toMatchObject([{ from: FRONT, body: "Saturday works." }]);
  });

  it("asks while the client's mail sends are off", async () => {
    await updateClient(pg.db, "kappa", { sends: ["follow_up"] });
    const out = await svc().inboxReply({ ...as(BO), ...mail(front), body: "Hi." });
    expect(out).toMatchObject({ sent: false, why: "Sends are off for this client." });
    expect(mailed).toEqual([]);
  });

  it("a mailbox that isn't connected: Needs setup, Account → Mail; nothing goes", async () => {
    expect(await replyOf(`mail:${billing}`)).toMatchObject({
      off: `Needs setup: ${BILLING} isn't connected to send.`,
      fix: "mail",
    });
    await expect(
      svc().inboxReply({ ...as(BO), ...mail(billing), body: "Refunded." }),
    ).rejects.toThrow(/Needs setup/);
    await expect(
      svc().inboxAsk({ ...as(AMY), ...mail(billing), body: "Refunded." }),
    ).rejects.toThrow(/Needs setup/);
    expect(mailed).toEqual([]);
    expect(await askedReplyRecord.rows?.(kappa)).toEqual([]);
  });

  it("a refused send is kept as failed and said", async () => {
    refusing = FRONT;
    await expect(
      svc().inboxReply({ ...as(BO), ...mail(front), body: "A crown is $1,200." }),
    ).rejects.toThrow(/Insufficient Permission/);
    const c = await conversationOf(kappa, `mail:${front}`);
    expect(c?.entries.at(-1)).toMatchObject({ direction: "out", state: "failed" });
  });

  it("another client's login can't answer kappa's mail", async () => {
    await expect(
      svc().inboxReply({ ...as(LEE, "kappa"), ...mail(front), body: "hi" }),
    ).rejects.toThrow();
    expect(mailed).toEqual([]);
  });
});

describe("isolation", () => {
  it("never reaches another client's threads through its own console", async () => {
    await expect(
      svc().inboxNote({ ...as(AMY, "lambda"), thread: `text:${l.smsId}`, body: "hi" }),
    ).rejects.toThrow();
    const c = await conversationOf(lambda, `text:${l.smsId}`);
    expect(c?.entries.some((e) => e.channel === "note")).toBe(false);
  });

  it("the same thread id writes the viewer's own client only", async () => {
    // Three fresh databases seeded alike share ids: kappa's login closes kappa's only.
    expect([l.smsId, w.smsId]).toEqual([k.smsId, k.smsId]);
    await svc().inboxStatus({ ...as(AMY), thread: `text:${k.smsId}`, status: "closed" });
    expect(await statusOf(kappa, `text:${k.smsId}`)).toBe("closed");
    expect(await statusOf(lambda, `text:${l.smsId}`)).toBe("open");
    expect(await statusOf(pg.db, `text:${w.smsId}`)).toBe("open");
  });

  it("an asked reply from another client can't be approved or dropped", async () => {
    const { asked } = await svc().inboxAsk({
      ...as(LEE, "lambda"),
      ...text(l),
      body: "Lambda's words",
    });
    await expect(svc().inboxApprove({ ...as(BO), id: asked as number })).rejects.toThrow();
    // Kappa's database has no such reply: nothing to drop there.
    expect(await svc().inboxDrop({ ...as(BO), id: asked as number })).toEqual({ dropped: false });
    expect(sent).toEqual([]);
    expect((await askedReplyRecord.rows?.(lambda))?.[0]).toMatchObject({ state: "waiting" });
  });

  it("InboxDesk itself: a client login never works Wren's or another client's", async () => {
    const at = { thread: `text:${w.smsId}`, body: "hi" };
    await expect(desk().note({ ...at, viewer: { email: AMY } })).rejects.toThrow(
      /Wren's Inbox is the team's/,
    );
    await expect(desk().note({ ...at, client: "lambda", viewer: { email: AMY } })).rejects.toThrow(
      /can't do that here/,
    );
    await expect(
      desk().reply({ ...text(l), client: "lambda", body: "hi", viewer: { email: BO } }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("Wren's team still works a client's thread when its scope covers it", async () => {
    await svc().inboxNote({ ...as(ADMIN), thread: `text:${k.smsId}`, body: "checked" });
    const c = await conversationOf(kappa, `text:${k.smsId}`);
    expect(c?.entries.find((e) => e.channel === "note")).toMatchObject({ who: ADMIN });
  });
});
