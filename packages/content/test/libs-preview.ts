/**
 * A local database for the libraries' browser pass (designs/2026-10-16-portal-libs.md): the
 * Inbox's synthetic threads (`inbox-preview.ts` runs first), then 600 made-up people at one
 * made-up firm, each with a 555 number and so a profile, so People runs long enough to scroll. Local only.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_libs npx tsx packages/content/test/inbox-preview.ts
 *   WREN_DATABASE_URL=... npx tsx packages/content/test/libs-preview.ts
 */
import { backfillProfiles } from "@wren/core/profiles-backfill";
import { createDb } from "@wren/db";
import { sql } from "drizzle-orm";

const url = process.env.WREN_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("a local database only");
const { db, close } = createDb(url, { max: 1 });
const [firm] = (await db.execute(
  sql`insert into companies (name, domain) values ('Sample Roofing Co',
    'sample-roofing.example.test') returning id`,
)) as unknown as { id: number }[];
const FIRST = [
  "Avery",
  "Blake",
  "Casey",
  "Drew",
  "Emery",
  "Finley",
  "Gray",
  "Harper",
  "Indy",
  "Jules",
];
const LAST = ["Stone", "Brook", "Vale", "Reed", "Lane", "Frost", "Wells", "Hart", "Moss", "Pike"];
const TITLES = ["Owner", "Office manager", "Estimator", "Operations lead"];
for (let i = 0; i < 600; i++) {
  const first = FIRST[i % FIRST.length] ?? "Sam";
  const last = `${LAST[Math.floor(i / FIRST.length) % LAST.length]}${Math.floor(i / 100) || ""}`;
  const name = `${first} ${last}`;
  const [person] = (await db.execute(sql`insert into people (company_id, full_name, first_name,
      last_name, title, is_compliance, origin, origin_ref, raw)
    values (${firm?.id}, ${name}, ${first}, ${last}, ${TITLES[i % TITLES.length]},
      false, 'manual', ${`libs-seed-${i}`}, '{}'::jsonb) returning id`)) as unknown as {
    id: number;
  }[];
  // A made-up 555 number each, so every one becomes a profile.
  await db.execute(sql`insert into sms_contacts (e164, source_kind, basis, person_id, company_id,
      name, state)
    values (${`+1555${String(2000000 + i)}`}, 'manual', 'opt_in', ${person?.id}, ${firm?.id},
      ${name}, 'new')`);
}
await backfillProfiles(db);
await close();
console.log("seeded 600 people");
