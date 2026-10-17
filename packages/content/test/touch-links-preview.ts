/**
 * A local database for looking at touch links (designs/2026-10-17-people-depth.md, item 3): one
 * person with touches that open their item (a Reddit comment, a LinkedIn comment) and touches
 * with no link of their own (our comment, an invite, an Instagram comment whose old url is the
 * numeric media form), all on one profile. Every name and id is made up. Local only.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_pd_links \
 *     npx tsx packages/content/test/touch-links-preview.ts
 */
import { resolveProfile } from "@wren/core/profiles";
import { itemLink } from "@wren/core/touch-link";
import { recordTouch } from "@wren/core/touches";
import { createDb, migrate } from "@wren/db";
import { sql } from "drizzle-orm";

const url = process.env.WREN_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("a local database only");
const { db, close } = createDb(url, { max: 1 });
await migrate(db);
await db.execute(
  sql`truncate touches, social_handles, profile_keys, profiles, people, companies restart identity cascade`,
);
await db.execute(sql`insert into operators (email, role) values ('preview@localhost', 'admin')
  on conflict do nothing`);
const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000);
const row = async (q: ReturnType<typeof sql>) =>
  Number(((await db.execute(q)) as unknown as Array<{ id: number }>)[0]?.id);

const company = await row(
  sql`insert into companies (name, domain, niche) values ('Sample Staffing', 'sample-staffing.example.test', 'recruiting') returning id`,
);
const person =
  await row(sql`insert into people (company_id, full_name, title, is_compliance, origin,
  origin_ref, raw, linkedin_url)
  values (${company}, 'Sam Sample', 'Owner', false, 'website', 'preview', '{}'::jsonb,
    'https://www.linkedin.com/in/sam-sample/') returning id`);

const POST = "urn:li:activity:7000000000000000001";
const redditUrl = "https://www.reddit.com/r/sample/comments/abc123/how_we_chase_invoices/";
const items = [
  {
    platform: "linkedin",
    handle: "https://www.linkedin.com/in/sam-sample/",
    kind: "connect" as const,
    direction: "ours" as const,
    url: "https://www.linkedin.com/in/sam-sample/",
    link: null,
    text: null,
    at: ago(72),
    ref: "preview:connect",
  },
  {
    platform: "linkedin",
    handle: "https://www.linkedin.com/in/sam-sample/",
    kind: "comment" as const,
    direction: "theirs" as const,
    url: `https://www.linkedin.com/feed/update/${POST}/`,
    link: itemLink("linkedin", "comment", { externalId: "7100", post: POST }),
    text: "Agree. Three calls a week is the floor.",
    at: ago(30),
    ref: "preview:li-theirs",
  },
  {
    platform: "linkedin",
    handle: "https://www.linkedin.com/in/sam-sample/",
    kind: "comment" as const,
    direction: "ours" as const,
    url: `https://www.linkedin.com/feed/update/${POST}/`,
    link: null,
    text: "Same here until we texted every missed call back.",
    at: ago(24),
    ref: "preview:li-ours",
  },
  {
    platform: "reddit",
    handle: "sam_sample",
    kind: "reply" as const,
    direction: "theirs" as const,
    url: redditUrl,
    link: itemLink("reddit", "reply", { externalId: "t1_def456", post: "t3_abc123" }),
    text: "Which CRM do you use for this?",
    at: ago(10),
    ref: "preview:reddit",
  },
  {
    platform: "instagram",
    handle: "sam_sample",
    kind: "comment" as const,
    direction: "theirs" as const,
    url: "https://www.instagram.com/p/17800000000000009/",
    link: null,
    text: "Love this one.",
    at: ago(5),
    ref: "preview:ig-old",
  },
];
for (const i of items)
  await recordTouch(db, { ...i, name: "Sam Sample", account: "wren", source: "preview" });
await resolveProfile(
  db,
  [
    { kind: "person", value: person },
    { kind: "handle:linkedin", value: "https://www.linkedin.com/in/sam-sample/" },
    { kind: "handle:reddit", value: "sam_sample" },
    { kind: "handle:instagram", value: "sam_sample" },
  ],
  "preview",
  { name: "Sam Sample" },
);
await close();
console.log("seeded");
