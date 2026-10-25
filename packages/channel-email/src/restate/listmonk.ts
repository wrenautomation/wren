/**
 * Listmonk's three parts in Wren (designs/2026-10-21-esign-and-newsletter.md).
 *
 * `ListmonkIntake`: the postback door. Listmonk posts each message of a campaign here, one POST per
 * subscriber, and gets a 200 at once; the mail itself is sent by `ListmonkMail`.
 * `ListmonkMail`: keyed `<campaign>:<recipient>`, so a repeat of one message is the same call. It
 * delivers through `deliverIssue`, the gate and mail the direct loop uses: `mayMarket`, the
 * footer with the one-click unsubscribe, portal@, a Message-ID the bounce reader matches.
 * `ListmonkSync`: hourly, Wren's consents to Listmonk's lists and back (`../listmonk/sync.ts`).
 */
import * as restate from "@restatedev/restate-sdk";
import { consentIdOf, emailTopics, topicConsents, withdrawConsent } from "@wren/core/marketing";
import { tagLinks } from "@wren/core/message-settings";
import {
  exclusiveHandler,
  makeLoopObject,
  pausedPass,
  runPass,
  serviceHandler,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import { issueOf } from "../listmonk/campaign.js";
import type { Listmonk } from "../listmonk/client.js";
import { syncTopic as syncOneTopic, type TopicSync } from "../listmonk/sync.js";
import {
  deliverIssue,
  type IssueMailer,
  type IssueSent,
  issueTags,
  recordIssueSend,
} from "./newsletter.js";

/** One message as Listmonk's postback messenger sends it (probed on 6.2.0). */
const MESSAGE = z.looseObject({
  subject: z.string(),
  body: z.string(),
  campaign: z.looseObject({
    uuid: z.string().min(1),
    name: z.string(),
    tags: z.array(z.string()).nullish(),
  }),
  recipients: z
    .array(z.looseObject({ uuid: z.string().min(1), email: z.string().email() }))
    .length(1),
});
export type ListmonkMessage = z.infer<typeof MESSAGE>;

export function makeListmonkMail(deps: IssueMailer) {
  const { db } = deps;
  return restate.object({
    name: "ListmonkMail",
    handlers: {
      /**
       * One message. A repeat is harmless: `deliverIssue` skips an address the issue already went
       * to, and the object's key makes two copies of one message wait for each other.
       */
      send: exclusiveHandler(
        { input: MESSAGE, effect: "sends", ingressPrivate: true },
        async (ctx: restate.ObjectContext, m: ListmonkMessage): Promise<IssueSent> => {
          const issue = issueOf(m.campaign);
          // A setup mistake, not a message to retry: it shows in the console, and sends nothing.
          if (!issue)
            throw new restate.TerminalError(
              `campaign "${m.campaign.name}" names no topic: tag it wren-topic:<topic>`,
            );
          const to = m.recipients[0]?.email ?? "";
          const known = await ctx.run("consent", async () =>
            (await emailTopics(db)).some((t) => t.name === issue.topic)
              ? { id: await consentIdOf(db, "email", to, issue.topic) }
              : null,
          );
          if (!known)
            throw new restate.TerminalError(
              `campaign "${m.campaign.name}": no email topic "${issue.topic}"`,
            );
          const consentId = known.id;
          if (consentId === null) return { skip: "no consent" };
          const done = await ctx.run("deliver", async () => {
            const tags = await issueTags(db, issue.slug);
            return deliverIssue(deps, {
              issueKey: issue.key,
              topic: issue.topic,
              consentId,
              address: to,
              build: (wrap) => ({
                to,
                subject: m.subject,
                text: `${tags ? tagLinks(m.body, tags) : m.body}${wrap.footer}`,
                headers: wrap.headers,
              }),
            });
          });
          if ("skip" in done) return done;
          // Its own step: a failed write retries alone and never mails the address again.
          await ctx.run("sent", () =>
            recordIssueSend(db, {
              consentId,
              issueKey: issue.key,
              slug: issue.slug,
              messageId: done.messageId,
              evidence: { campaign: m.campaign.uuid },
            }),
          );
          return done;
        },
      ),
    },
  });
}
export type ListmonkMail = ReturnType<typeof makeListmonkMail>;

/** The door Listmonk posts to. Loopback on the box; the public ingress asks for the bearer. */
export function makeListmonkIntake() {
  return restate.service({
    name: "ListmonkIntake",
    handlers: {
      post: serviceHandler(
        { input: MESSAGE, effect: "sends" },
        async (ctx: restate.Context, m: ListmonkMessage): Promise<{ ok: true }> => {
          const key = `${m.campaign.uuid}:${m.recipients[0]?.uuid}`;
          ctx.objectSendClient<ListmonkMail>({ name: "ListmonkMail" }, key).send(m);
          return { ok: true };
        },
      ),
    },
  });
}
export type ListmonkIntake = ReturnType<typeof makeListmonkIntake>;
export const SYNC_COMMAND = "listmonk sync";
export const SYNC_EVERY_MS = 3_600_000;

export interface SyncDeps {
  db: Db;
  lm: Listmonk;
}

/** One email topic: the list is made if missing, subscribers move both ways. Returns the list's id. */
export async function syncTopicNamed(
  d: SyncDeps,
  topic: { name: string; publicName?: string | null },
): Promise<TopicSync> {
  return syncOneTopic({
    lm: d.lm,
    topic: topic.name,
    publicName: topic.publicName ?? null,
    consents: await topicConsents(d.db, topic.name),
    withdraw: (c) =>
      withdrawConsent(d.db, {
        channel: "email",
        address: c.address,
        topic: topic.name,
        by: "listmonk",
        evidence: { source: "listmonk unsubscribe" },
      }),
  });
}

/** One topic by name: the same sync, for the send that needs its list now. Returns the list's id. */
export async function syncTopicByName(d: SyncDeps, name: string): Promise<number> {
  const topic = (await emailTopics(d.db)).find((t) => t.name === name) ?? {
    name,
    publicName: null,
  };
  return (await syncTopicNamed(d, topic)).listId;
}

export interface SyncStats extends Record<string, unknown> {
  topics: TopicSync[];
}

/** Every email topic that has a consent, one after another. A topic that fails stops the pass, so the ledger shows it. */
export async function syncAllTopics(d: SyncDeps): Promise<SyncStats> {
  const topics: TopicSync[] = [];
  for (const t of await emailTopics(d.db)) {
    if ((await topicConsents(d.db, t.name)).length === 0) continue;
    topics.push(await syncTopicNamed(d, t));
  }
  return { topics };
}

export function makeListmonkSync(deps: { db: Db; lm: Listmonk | null; everyMs?: number }) {
  const every = deps.everyMs ?? SYNC_EVERY_MS;
  return makeLoopObject("ListmonkSync", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const { db, lm } = deps;
    // Without Listmonk's settings the loop waits and looks again: it resumes once they are set.
    if (!lm)
      return pausedPass<SyncStats>(ctx, now, "needs WREN_LISTMONK_URL, _USER and _TOKEN", every);
    return runPass<SyncStats>(ctx, db, now, {
      name: "listmonk sync",
      ledger: { command: SYNC_COMMAND, argv: { daemon: true } },
      body: () => syncAllTopics({ db, lm }),
      delayAfter: () => every,
      retryMs: every,
    });
  });
}
export type ListmonkSync = ReturnType<typeof makeListmonkSync>;
