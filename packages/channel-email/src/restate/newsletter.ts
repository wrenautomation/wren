/**
 * `Newsletter` (designs/2026-10-11-newsletter.md): one blog post mailed to everyone confirmed on
 * its topic, keyed `<topic>:<slug>`. The post is the email: the lander serves its plain text at
 * /blog/<slug>.json and `wren newsletter send` hands it here. Each address passes `mayMarket` at
 * its own send and gets the issue once, whatever reruns: the send's evidence names the issue.
 * Mail goes from portal@ with one-click unsubscribe, the preference link and the postal address.
 *
 * With Listmonk configured (designs/2026-10-21-esign-and-newsletter.md) the send hands the issue
 * to a Listmonk campaign instead: Listmonk keeps the list and the queue, and posts each message
 * back to `ListmonkMail` (`./listmonk.ts`), which delivers it through `deliverIssue` below, the same
 * gate and mail the loop uses. A test still goes direct.
 */
import * as restate from "@restatedev/restate-sdk";
import { mintMessageId } from "@wren/core/bounces";
import {
  issueAudience,
  issueSentTo,
  linkKey,
  marketingEnvelope,
  mayMarket,
  recordMarketingSend,
} from "@wren/core/marketing";
import { type LinkTags, readMessageSettings, tagLinks } from "@wren/core/message-settings";
import { exclusiveHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import { startCampaign } from "../listmonk/campaign.js";
import { type Listmonk, ListmonkError } from "../listmonk/client.js";
import type { PlainMail } from "../send/gmail.js";

export type IssueSent = { messageId: string } | { skip: string };

/** Under Gmail's 2,000 a day for a Workspace mailbox, with room for the confirm emails. */
const ISSUE_DAILY = 1500;
const DAY_MS = 86_400_000;
/** Between two sends: a steady trickle, never a burst. */
const GAP_MS = 1000;

export interface Issue {
  topic: string;
  slug: string;
  /** The post's title. */
  subject: string;
  /** The post as plain text. */
  text: string;
  /** The post on the lander. */
  url: string;
  /** Only this address, subject marked [test], nothing recorded. Our own domain only. */
  test?: string;
}

interface IssueRun {
  sent: number;
  /** Why the rest didn't get it: "already", "paused", "capped", "suppressed", ... */
  skipped: Record<string, number>;
  /** Through Listmonk: the campaign that now sends it. `sent` counts from the sends' records. */
  campaign?: { id: number; status: string; toSend: number };
}

const ISSUE = z.looseObject({
  topic: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  subject: z.string().min(1).max(200),
  text: z.string().min(1),
  url: z.string().url(),
  test: z.string().email().optional(),
});

/** The post, then a line to its page: what every copy of an issue carries before its footer. */
export const issueBody = (issue: Pick<Issue, "text" | "url">) =>
  `${issue.text}\n\nOn the site, with the pictures: ${issue.url}`;

/**
 * The issue's text for one address: the post, a line to the page, then the envelope's footer.
 * `tags` puts utm parameters on the post's links; the footer's signed links are left as they are.
 */
export function issueMail(o: {
  issue: Issue;
  to: string;
  footer: string;
  headers: [string, string][];
  test?: boolean;
  tags?: LinkTags | null;
}): PlainMail {
  const body = issueBody(o.issue);
  return {
    to: o.to,
    subject: o.test ? `[test] ${o.issue.subject}` : o.issue.subject,
    text: `${o.tags ? tagLinks(body, o.tags) : body}${o.footer}`,
    headers: o.headers,
  };
}

/** Whether a test may go to `address`: only to the sending domain, so a test never reaches a subscriber. */
export const testAllowed = (address: string, from: string) =>
  address.toLowerCase().endsWith(`@${from.split("@")[1]?.toLowerCase()}`);

/** What sending an issue needs: the secret that signs links, the sender, the postal address, the mail. */
export interface IssueMailer {
  db: Db;
  /** The secret the lander and Wren share: the preference links are signed with it. */
  shared: string | null;
  site: string;
  /** portal@: tests may only go to its domain. */
  from: string | null;
  /** The postal address every marketing email carries (`WREN_MARKETING_POSTAL`). */
  postal: string | null;
  send: ((m: PlainMail) => Promise<void>) | null;
}

/** The mailer's parts, or a terminal error saying which one is missing. */
function mailerReady(d: IssueMailer) {
  const { shared, send, from, postal } = d;
  if (!shared || !send || !from)
    throw new restate.TerminalError("newsletter is off: needs the site secret and portal@");
  if (!postal?.trim())
    throw new restate.TerminalError("needs WREN_MARKETING_POSTAL: the law asks for one");
  return { key: linkKey(shared), send, from, postal };
}

/** The footer and headers an address gets on a topic. */
type IssueWrap = { footer: string; headers: [string, string][] };

const issueWrap = (
  d: IssueMailer,
  topic: string,
  address: string,
  ready: ReturnType<typeof mailerReady>,
): IssueWrap =>
  marketingEnvelope({
    key: ready.key,
    site: d.site,
    address,
    topic,
    postal: ready.postal,
    why: "You signed up for new posts at wrenautomation.com.",
  });

/**
 * One address, one issue: skipped when it already went there, held by `mayMarket`, else mailed.
 * The Message-ID is minted here and comes back with the send: bounces find the message by it.
 * Recording the send is a separate step (`recordIssueSend`), so a failed write retries alone and
 * never mails the address again.
 */
export async function deliverIssue(
  d: IssueMailer,
  o: {
    issueKey: string;
    topic: string;
    consentId: number;
    address: string;
    /** The mail for this address, given its footer and headers. */
    build: (wrap: IssueWrap) => PlainMail;
  },
): Promise<IssueSent> {
  const ready = mailerReady(d);
  if (await issueSentTo(d.db, o.consentId, o.issueKey)) return { skip: "already" };
  const v = await mayMarket(d.db, { channel: "email", address: o.address, topic: o.topic });
  if (!v.send) return { skip: v.why };
  const messageId = mintMessageId(ready.from.split("@")[1] ?? "");
  await ready.send({ ...o.build(issueWrap(d, o.topic, o.address, ready)), messageId });
  return { messageId };
}

/** The send's record: the cap counts it, and the issue's evidence makes a rerun skip it. */
export const recordIssueSend = (
  db: Db,
  o: {
    consentId: number;
    issueKey: string;
    slug: string;
    messageId: string;
    evidence?: Record<string, unknown>;
  },
) =>
  recordMarketingSend(db, {
    consentId: o.consentId,
    by: "newsletter",
    evidence: { issue: o.issueKey, ...o.evidence },
    campaign: o.slug,
    messageId: o.messageId,
  });

/** The workspace's switch for tagging links, as the tags this issue's links get. */
export async function issueTags(db: Db, slug: string): Promise<LinkTags | null> {
  return (await readMessageSettings(db)).utmLinks
    ? { source: "wren", medium: "email", campaign: slug }
    : null;
}

export function makeNewsletter(
  deps: IssueMailer & {
    /** Listmonk, when configured: the issue goes out as one of its campaigns. Null: the direct loop. */
    listmonk?: Listmonk | null;
    /** Brings a topic's list and subscribers in line with Wren's consents; returns the list's id. */
    syncTopic?: (topic: string) => Promise<number>;
  },
) {
  const { db } = deps;
  return restate.object({
    name: "Newsletter",
    handlers: {
      send: exclusiveHandler(
        { input: ISSUE, effect: "sends" },
        async (ctx: restate.ObjectContext, issue: Issue): Promise<IssueRun> => {
          const ready = mailerReady(deps);
          const { send, from } = ready;
          if (ctx.key !== `${issue.topic}:${issue.slug}`)
            throw new restate.TerminalError(`key must be ${issue.topic}:${issue.slug}`);
          // The workspace's switch, read once so a retried step sends what the first would have.
          const tags = await ctx.run("utm", () => issueTags(db, issue.slug));
          if (issue.test) {
            const to = issue.test.toLowerCase();
            if (!testAllowed(to, from))
              throw new restate.TerminalError(`a test goes to @${from.split("@")[1]} only`);
            await ctx.run("test", () =>
              send(
                issueMail({
                  issue,
                  to,
                  ...issueWrap(deps, issue.topic, to, ready),
                  test: true,
                  tags,
                }),
              ),
            );
            return { sent: 1, skipped: {} };
          }

          if (deps.listmonk && deps.syncTopic) {
            const { listmonk, syncTopic } = deps;
            const campaign = await ctx.run("campaign", async () => {
              try {
                return await startCampaign(listmonk, {
                  listId: await syncTopic(issue.topic),
                  topic: issue.topic,
                  slug: issue.slug,
                  subject: issue.subject,
                  body: issueBody(issue),
                });
              } catch (e) {
                // A refusal from Listmonk is final (bad settings, a missing messenger): say so.
                if (e instanceof ListmonkError && e.status >= 400 && e.status < 500)
                  throw new restate.TerminalError(e.message);
                throw e;
              }
            });
            const run: IssueRun = { sent: 0, skipped: {}, campaign };
            ctx.set("run", run);
            return run;
          }

          const audience = await ctx.run("audience", () => issueAudience(db, issue.topic));
          const run: IssueRun = { sent: 0, skipped: {} };
          for (const c of audience) {
            const done = await ctx.run(`to ${c.consentId}`, () =>
              deliverIssue(deps, {
                issueKey: ctx.key,
                topic: issue.topic,
                consentId: c.consentId,
                address: c.address,
                build: (wrap) => issueMail({ issue, to: c.address, ...wrap, tags }),
              }),
            );
            if ("skip" in done) {
              run.skipped[done.skip] = (run.skipped[done.skip] ?? 0) + 1;
              continue;
            }
            // Its own step: a failed write retries alone and never mails the address again.
            await ctx.run(`sent ${c.consentId}`, () =>
              recordIssueSend(db, {
                consentId: c.consentId,
                issueKey: ctx.key,
                slug: issue.slug,
                messageId: done.messageId,
                evidence: { url: issue.url },
              }),
            );
            run.sent += 1;
            ctx.set("run", run);
            await ctx.sleep(run.sent % ISSUE_DAILY === 0 ? DAY_MS : GAP_MS);
          }
          ctx.set("run", run);
          return run;
        },
      ),
    },
  });
}

export type Newsletter = ReturnType<typeof makeNewsletter>;
