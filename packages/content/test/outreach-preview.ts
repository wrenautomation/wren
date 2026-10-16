/**
 * A local database for looking at Outreach (designs/2026-10-16-outreach-app.md): the Inbox's
 * synthetic seed (its LinkedIn DM is a DMs row), plus a second LinkedIn account, an invite
 * waiting on his yes from that account, an accepted one no one has written to yet, and someone
 * else's post with our comment drafted. Every name is made up. Local only.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_outreach_preview \
 *     npx tsx packages/content/test/outreach-preview.ts
 */
import { createDb, migrate } from "@wren/db";
import { sql } from "drizzle-orm";
import { INBOX_TABLES, seedInbox } from "./inbox-seed.js";

const url = process.env.WREN_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("a local database only");
const { db, close } = createDb(url, { max: 1 });
await migrate(db);
await db.execute(
  sql.raw(
    `truncate ${["reach_posts", ...INBOX_TABLES].map((t) => `"${t}"`).join(", ")} restart identity cascade`,
  ),
);
await db.execute(sql`insert into operators (email, role) values ('preview@localhost', 'admin')
  on conflict do nothing`);
await seedInbox(db);

const now = new Date();
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
type Row = Record<string, unknown>;
const id = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as Row[])[0]?.id;

const alt = await id(sql`insert into reach_accounts (platform, account, handle, started_on)
  values ('linkedin', 'linkedin@alt', 'alt-sample', ${now.toISOString().slice(0, 10)})
  returning id`);
const [main] = (await db.execute(
  sql`select id from reach_accounts where account = 'linkedin@wren'`,
)) as unknown as Row[];

// Proposed from the second account: waits on his yes.
const proposed = await id(sql`insert into reach_contacts (platform, handle, url, found_in, name,
    headline, account_id, state, fit)
  values ('linkedin', 'alex-sample', 'https://linkedin.example.test/in/alex', 'people',
    'Alex Sample', 'Founder, Sample HVAC', ${alt}, 'enrolled',
    '{"why": "Founder at Sample HVAC."}'::jsonb) returning id`);
await db.execute(sql`insert into reach_messages (contact_id, account_id, direction, kind, body,
    state, created_at)
  values (${proposed}, ${alt}, 'out', 'connect', '', 'proposed', ${ago(60)})`);

// Accepted from the main account, nothing written since: To message.
const accepted = await id(sql`insert into reach_contacts (platform, handle, url, found_in, name,
    headline, account_id, state, connected_at)
  values ('linkedin', 'jordan-sample', 'https://linkedin.example.test/in/jordan', 'people',
    'Jordan Sample', 'Owner, Sample Roofing', ${main?.id}, 'connected', ${ago(120)})
  returning id`);
await db.execute(sql`insert into reach_messages (contact_id, account_id, direction, kind, body,
    state, sent_at, created_at)
  values (${accepted}, ${main?.id}, 'out', 'connect', '', 'sent', ${ago(3000)}, ${ago(3000)})`);

// Someone else's post, our comment drafted and queued.
await db.execute(sql`insert into reach_posts (platform, ref, author, handle, headline, text, url,
    posted_at, found_by, account, fit, why, state, draft, queued_at, raw)
  values ('linkedin', 'urn:li:activity:7000000000000000001', 'Pat Example', 'pat-example',
    'Owner, Sample Electric', 'Half our calls come in after five. Nobody picks up.',
    'https://linkedin.example.test/posts/1', ${ago(240)}, 'topic: missed calls', 'linkedin@wren',
    80, 'Owner on missed calls.', 'queued', 'Same here until we texted every missed call back.',
    ${ago(30)}, '{}'::jsonb)`);
await close();
console.log("seeded");
