/**
 * `Newsletter` (designs/2026-10-11-newsletter.md): one blog post mailed to everyone confirmed on
 * its topic, keyed `<topic>:<slug>`. The post is the email: the lander serves its plain text at
 * /blog/<slug>.json and `wren newsletter send` hands it here. Each address passes `mayMarket` at
 * its own send and gets the issue once, whatever reruns: the send's evidence names the issue.
 * Mail goes from portal@ with one-click unsubscribe, the preference link and the postal address.
 */
import * as restate from "@restatedev/restate-sdk";
import {
  issueAudience,
  issueSentTo,
  linkKey,
  marketingEnvelope,
  mayMarket,
  recordMarketingSend,
} from "@wren/core/marketing";
import { exclusiveHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { z } from "zod";
import type { PlainMail } from "../send/gmail.js";

/** Under Gmail's 2,000 a day for a Workspace mailbox, with room for the confirm emails. */
export const ISSUE_DAILY = 1500;
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

export interface IssueRun {
  sent: number;
  /** Why the rest didn't get it: "already", "paused", "capped", "suppressed", ... */
  skipped: Record<string, number>;
}

const ISSUE = z.looseObject({
  topic: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  subject: z.string().min(1).max(200),
  text: z.string().min(1),
  url: z.string().url(),
  test: z.string().email().optional(),
});

/** The issue's text for one address: the post, a line to the page, then the envelope's footer. */
export function issueMail(o: {
  issue: Issue;
  to: string;
  footer: string;
  headers: [string, string][];
  test?: boolean;
}): PlainMail {
  return {
    to: o.to,
    subject: o.test ? `[test] ${o.issue.subject}` : o.issue.subject,
    text: `${o.issue.text}\n\nOn the site, with the pictures: ${o.issue.url}${o.footer}`,
    headers: o.headers,
  };
}

/** Whether a test may go to `address`: only to the sending domain, so a test never reaches a subscriber. */
export const testAllowed = (address: string, from: string) =>
  address.toLowerCase().endsWith(`@${from.split("@")[1]?.toLowerCase()}`);

export function makeNewsletter(deps: {
  db: Db;
  /** The secret the lander and Wren share: the preference links are signed with it. */
  shared: string | null;
  site: string;
  /** portal@: tests may only go to its domain. */
  from: string | null;
  /** The postal address every marketing email carries (`WREN_MARKETING_POSTAL`). */
  postal: string | null;
  send: ((m: PlainMail) => Promise<void>) | null;
}) {
  const { db } = deps;
  return restate.object({
    name: "Newsletter",
    handlers: {
      send: exclusiveHandler(
        { input: ISSUE, effect: "sends" },
        async (ctx: restate.ObjectContext, issue: Issue): Promise<IssueRun> => {
          const { shared, send, from, postal } = deps;
          if (!shared || !send || !from)
            throw new restate.TerminalError("newsletter is off: needs the site secret and portal@");
          if (!postal?.trim())
            throw new restate.TerminalError("needs WREN_MARKETING_POSTAL: the law asks for one");
          if (ctx.key !== `${issue.topic}:${issue.slug}`)
            throw new restate.TerminalError(`key must be ${issue.topic}:${issue.slug}`);
          const key = linkKey(shared);
          const envelope = (address: string) =>
            marketingEnvelope({
              key,
              site: deps.site,
              address,
              topic: issue.topic,
              postal,
              why: "You signed up for new posts at wrenautomation.com.",
            });
          if (issue.test) {
            const to = issue.test.toLowerCase();
            if (!testAllowed(to, from))
              throw new restate.TerminalError(`a test goes to @${from.split("@")[1]} only`);
            await ctx.run("test", () =>
              send(issueMail({ issue, to, ...envelope(to), test: true })),
            );
            return { sent: 1, skipped: {} };
          }

          const audience = await ctx.run("audience", () => issueAudience(db, issue.topic));
          const run: IssueRun = { sent: 0, skipped: {} };
          for (const c of audience) {
            const done = await ctx.run(`to ${c.consentId}`, async () => {
              if (await issueSentTo(db, c.consentId, ctx.key)) return "already";
              const v = await mayMarket(db, {
                channel: "email",
                address: c.address,
                topic: issue.topic,
              });
              if (!v.send) return v.why;
              await send(issueMail({ issue, to: c.address, ...envelope(c.address) }));
              return "sent";
            });
            if (done !== "sent") {
              run.skipped[done] = (run.skipped[done] ?? 0) + 1;
              continue;
            }
            // Its own step: a failed write retries alone and never mails the address again.
            await ctx.run(`sent ${c.consentId}`, () =>
              recordMarketingSend(db, {
                consentId: c.consentId,
                by: "newsletter",
                evidence: { issue: ctx.key, url: issue.url },
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
