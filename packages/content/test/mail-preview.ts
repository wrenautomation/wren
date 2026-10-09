/**
 * A local client for looking at mail replies in its Inbox (designs/2026-10-07-mail-access.md):
 * a synthetic client with Marketing, two mailboxes (one connected to send, one not), and mail in
 * each. Local only: it refuses any host but localhost.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_mail_preview \
 *     npx tsx packages/content/test/mail-preview.ts [client id]
 */
import { addClient } from "@wren/core/clients";
import { clientDatabaseUrl, createDb, migrate, migrateClient } from "@wren/db";
import { sql } from "drizzle-orm";

const url = process.env.WREN_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("a local database only");
const id = process.argv[2] ?? "mailpreview";
const { db, close } = createDb(url, { max: 1 });
await migrate(db);
await db.execute(sql`insert into operators (email, role) values ('preview@localhost', 'admin')
  on conflict do nothing`);
await addClient(db, url, { id, name: "Kappa Dental", products: { "marketing.stats": {} } });
await db.execute(sql`update clients set approver = 'either', sends = '{mail.triage}'
  where id = ${id}`);

const FRONT = "front@kappa.example";
const BILLING = "billing@kappa.example";
for (const [ref, role] of [
  ["kappa.example", "main"],
  [FRONT, "send"],
  [BILLING, "send"],
] as const)
  await db.execute(sql`insert into client_accounts (client, site, ref, role, created_by)
    values (${id}, ${ref.includes("@") ? "mailbox" : "google_workspace"}, ${ref}, ${role}, 'preview')
    on conflict do nothing`);
await db.execute(sql`insert into mail_connections (account_id, provider, address, scopes, access,
    token_name, state, by)
  select id, 'google', ref, 'openid email gmail.send', 'send', 'ks_preview', 'connected', 'preview'
  from client_accounts where client = ${id} and ref = ${FRONT}
  on conflict do nothing`);

await migrateClient(url, `wren_client_${id}`);
const c = createDb(clientDatabaseUrl(url, `wren_client_${id}`), { max: 1 });
await c.db.execute(sql`delete from watch.mail_sent`);
await c.db.execute(sql`delete from watch.mail`);
const at = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
await c.db.execute(sql`insert into watch.mail (mailbox, message_id, thread_id, from_name,
    from_address, subject, summary, verdict, at, reader)
  values
    (${FRONT}, 'pv-1', 'pt-1', 'Lee Park', 'lee@patient.example', 'Quote for a crown?',
      'Asks what a crown costs and if Saturday works.', 'show', ${at(95)}, 'mail'),
    (${BILLING}, 'pv-2', 'pt-2', 'Sam Ortiz', 'sam@patient.example', 'Invoice question',
      'Was charged twice for one cleaning.', 'show', ${at(40)}, 'mail'),
    (${FRONT}, 'pv-3', 'pt-1', 'Lee Park', 'lee@patient.example', 'Re: Quote for a crown?',
      'Thanks. Is 10am free?', 'show', ${at(20)}, 'mail')`);
// Our answer between theirs: the thread shows both ways.
await c.db.execute(sql`insert into watch.mail_sent (mail_id, mailbox, thread_id, to_address,
    subject, body, ours, state, by, created_at, sent_at)
  select id, mailbox, thread_id, from_address, 'Re: ' || subject,
    'A crown runs $1,200. Saturday morning works.', '<pv-ours@kappa.example>', 'sent',
    'preview@localhost', ${at(60)}, ${at(60)}
  from watch.mail where message_id = 'pv-1'`);
await c.close();
await close();
console.log("seeded", id);
