/**
 * Send message and Notify me on the spine (designs/2026-10-14-automations.md, Templates). Send
 * message is one person's broadcast: the same consent, suppression and cap gate (`mayMarket`),
 * the same words and fills, email through the workspace's mailer (`MailOf`) with its footer and
 * one-click unsubscribe, a text queued (kind `broadcast`) on their existing thread for the texts
 * sender. A client's runs in its own database and sends from the mailbox it picked in Account →
 * Messaging, as its broadcasts do. One with no mailer yet fails the step with why; a retry sends.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Queryable } from "@wren/db";
import { atomic } from "@wren/db/isolation";
import { and, eq, sql } from "drizzle-orm";
import { mintMessageId } from "./bounces.js";
import { checkWords, factsOf, isUnset, type MailOf, renderFor } from "./broadcasts.js";
import { dig } from "./logic.js";
import { addressOf, mayMarket, recordMarketingSend } from "./marketing.js";
import type { Notifier } from "./notify.js";
import { PortalRefusal } from "./refusal.js";
import { topics } from "./schema.js";
import type { SpineEvent, Step, StepAt } from "./spine.js";
import { fillText } from "./webhook-events.js";

type Channel = "email" | "sms";
type Row = Record<string, unknown>;
const TEXTS_ENDED = new Set(["opted_out", "unreachable", "stopped"]);
const VERDICT_WORDS: Record<string, string> = {
  suppressed: "On the do-not-contact list",
  "no consent": "Never said yes to this topic",
  pending: "Asked, never confirmed",
  withdrawn: "Took back their yes",
  paused: "Paused their messages",
  capped: "At their limit for now (frequency cap)",
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const first = (e: SpineEvent, ...paths: string[]) => {
  for (const p of paths) {
    const v = text(dig(e, p));
    if (v) return v;
  }
  return "";
};

/** Who the event is about, as the triggers carry them: a door lead, else the event's own fields. */
export function personOf(e: SpineEvent): { email: string; phone: string; name: string | null } {
  return {
    email: first(e, "data.lead.email", "data.email"),
    phone: first(e, "data.lead.phone", "data.phone"),
    name: first(e, "data.lead.name", "data.name") || null,
  };
}

const channelOf = (w: StepAt["with"]): Channel => (w.channel === "sms" ? "sms" : "email");

/** One send per workflow, node and subject, kept on the consent's sent event. */
const sentKey = (at: StepAt, e: SpineEvent) => ({
  workflow: at.workflow,
  node: at.node,
  subject: e.subject,
});

/** "Would email sam@example.com: Welcome": what a dry test says instead of sending. */
export function messageWould(w: StepAt["with"], e: SpineEvent): string {
  const p = personOf(e);
  const channel = channelOf(w);
  const to = channel === "email" ? p.email : p.phone;
  if (!to) return `Would skip: no ${channel === "email" ? "email address" : "phone number"}`;
  const topic = text(w.topic) || "its topic";
  return channel === "email"
    ? `Would email ${to} on ${topic}, if they said yes to it: "${text(w.subject)}"`
    : `Would text ${to} on ${topic}, if they said yes to it`;
}

/**
 * The Send message node's step. `main` is Wren's database; a client's workflow reads and writes
 * the client's own (`open`), where its consents, topics and threads live.
 */
export function messageStep(
  main: Queryable,
  deps: { mail: MailOf; open: (client: string) => Queryable },
): Step {
  return async (_port, e, at) => {
    const skip = (why: string) => [
      { port: "skipped", event: { ...e, data: { ...e.data, skipped: why } } },
    ];
    const db = at.client ? deps.open(at.client) : main;
    const w = at.with;
    const channel = channelOf(w);
    let words: { subject: string | null; body: string };
    try {
      words = checkWords(channel, text(w.subject) || null, String(w.body ?? ""));
    } catch (err) {
      if (err instanceof PortalRefusal)
        throw new restate.TerminalError(`Send message: ${err.message}`);
      throw err;
    }
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.name, text(w.topic)), eq(topics.channel, channel)));
    if (!topic)
      throw new restate.TerminalError(`Send message: no ${channel} topic called ${text(w.topic)}`);
    const person = personOf(e);
    const raw = channel === "email" ? person.email : person.phone;
    if (!raw) return skip(channel === "email" ? "No email address" : "No phone number");
    let address: string;
    try {
      address = addressOf(channel, raw);
    } catch {
      return skip("Their address doesn't read");
    }
    const key = sentKey(at, e);
    const already = (await db.execute(sql`select 1 from consent_events
      where kind = 'sent' and evidence @> ${JSON.stringify(key)}::jsonb limit 1`)) as unknown as Row[];
    if (already.length) return [{ port: "sent", event: e }];
    const now = new Date();
    const v = await mayMarket(db, { channel, address, topic: topic.name, now });
    if (!v.send) return skip(VERDICT_WORDS[v.why] ?? v.why);
    const copy = renderFor(
      { id: 0, channel, subject: words.subject, body: words.body },
      factsOf(person.name),
      e.subject,
    );
    if ("missing" in copy) return skip(`Nothing to fill in: ${copy.missing}`);
    const sent = { ...e, data: { ...e.data, message: { channel, to: address } } };

    if (channel === "sms") {
      const contacts = (await db.execute(
        sql`select id, number_id, state from sms_contacts where e164 = ${address} order by id desc`,
      )) as unknown as Row[];
      if (contacts.some((c) => TEXTS_ENDED.has(String(c.state))))
        return skip("Their texts ended (STOP or unreachable)");
      const c = contacts.find((x) => x.number_id);
      if (!c) return skip("No texts thread with them yet");
      const ref = `wf:${at.workflow}:${at.node}`.slice(0, 64);
      await atomic(db, async (tx) => {
        await tx.execute(sql`insert into sms_messages
            (contact_id, direction, kind, ref, number_id, to_e164, body, state, due_at, created_at)
          values (${Number(c.id)}, 'out', 'broadcast', ${ref}, ${String(c.number_id)}::uuid,
            ${address}, ${copy.body}, 'queued', ${now.toISOString()}::timestamptz,
            ${now.toISOString()}::timestamptz)
          on conflict do nothing`);
        // The texts sender counts the workspace's cap when it sends.
        await recordMarketingSend(tx, {
          consentId: v.consent.id,
          by: `workflow:${at.workflow}`,
          evidence: key,
          campaign: at.workflow,
          now,
          capped: false,
        });
      });
      return [{ port: "sent", event: sent }];
    }

    const mail = await deps.mail(at.client, db);
    if (isUnset(mail)) throw new restate.TerminalError(`Send message: ${mail.unset}`);
    // Kept first, with its Message-ID, so a retry after a cut-off send never sends twice and a
    // bounce finds it; a failed send takes it back.
    const messageId = mintMessageId(mail.domain);
    await recordMarketingSend(db, {
      consentId: v.consent.id,
      by: `workflow:${at.workflow}`,
      evidence: key,
      campaign: at.workflow,
      now,
      messageId,
    });
    const env = mail.envelope(address, { name: topic.name, publicName: topic.publicName });
    try {
      await mail.send({
        to: address,
        subject: copy.subject ?? topic.publicName,
        text: `${copy.body}${env.footer}`,
        headers: env.headers,
        messageId,
      });
    } catch (err) {
      await db.execute(sql`delete from consent_events
        where kind = 'sent' and evidence @> ${JSON.stringify(key)}::jsonb`);
      throw err;
    }
    return [{ port: "sent", event: sent }];
  };
}

/** The line Notify me sends, filled from the event: `{{data.lead.name}}` and the like. */
export function notifyLine(w: StepAt["with"], e: SpineEvent, workflow: string): string {
  const line = fillText(text(w.line), e).trim();
  return line || `${personOf(e).name ?? e.subject} reached ${workflow}`;
}

/** The Notify me node's step: one line to Wren's team, with a link to the run. */
export function notifyStep(
  notifierFor: (client: string | null) => Notifier | null,
  portal = "https://app.wrenautomation.com",
): Step {
  return async (_port, e, at) => {
    const n = notifierFor(at.client);
    const run = `${portal}/workflows/runs?execution=${encodeURIComponent(`${at.workflow}/${e.subject}`)}`;
    if (n) await n.notify(notifyLine(at.with, e, at.workflow), run, "info");
    return [{ port: "out", event: e }];
  };
}
