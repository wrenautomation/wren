/**
 * Message and Invite from People (designs/2026-10-06-content-desk.md, "Message from People"): a
 * person we hold (`li:<people.id>` with a LinkedIn page, `reddit:<handle>` read from Reddit) becomes
 * a reach contact (`found_in = people`) on first use. Message goes from `linkedin@wren` once they
 * accepted, or from `reddit@wren` to anyone; Invite queues `linkedin-invite` for them now.
 */
import { leadRefusal } from "@wren/core/leads";
import { handleOf } from "@wren/core/outreach";
import { companies, people } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { listAccounts } from "./accounts.js";
import { checkCanDm } from "./comments.js";
import { addProspects, contactByHandle } from "./contacts.js";
import { ReachRefusal } from "./refusal.js";
import { type Platform, type ReachAccount, type ReachContact, reachContacts } from "./schema.js";

/** Who writes to a person from People, by platform. */
export const PERSON_ACCOUNTS: Record<Platform, string> = {
  linkedin: "linkedin@wren",
  reddit: "reddit@wren",
};

/** The contact on `platform` whose handle matches, any case, or null. */
async function contactLike(db: Queryable, platform: Platform, handle: string) {
  const [row] = await db
    .select()
    .from(reachContacts)
    .where(
      and(
        eq(reachContacts.platform, platform),
        sql`lower(${reachContacts.handle}) = lower(${handle})`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** A People id's reach contact, added (`found_in = people`, person and firm linked) when new. */
export async function personContact(db: Queryable, id: string): Promise<ReachContact> {
  const at = id.indexOf(":");
  const [kind, ref] = [id.slice(0, at), id.slice(at + 1)];
  if (kind === "reddit") {
    const handle = handleOf("reddit", ref);
    const known = await contactLike(db, "reddit", handle);
    if (known) return known;
    await addProspects(db, "reddit", [
      {
        handle,
        url: `https://www.reddit.com/user/${handle}`,
        name: null,
        headline: null,
        foundIn: "people",
      },
    ]);
    return contactByHandle(db, "reddit", handle);
  }
  if (kind !== "li") throw new ReachRefusal(`not a person: ${id}`);
  const [p] = await db
    .select({
      id: people.id,
      companyId: people.companyId,
      name: people.fullName,
      title: people.title,
      url: people.linkedinUrl,
      niche: companies.niche,
    })
    .from(people)
    .innerJoin(companies, eq(companies.id, people.companyId))
    .where(eq(people.id, Number(ref)));
  const vanity = /linkedin\.com\/in\/([^/?#]+)/i.exec(p?.url ?? "")?.[1]?.toLowerCase();
  if (!p || !vanity) throw new ReachRefusal("that person has no LinkedIn page");
  let c = await contactLike(db, "linkedin", vanity);
  if (!c) {
    await addProspects(
      db,
      "linkedin",
      [
        {
          handle: vanity,
          url: `https://www.linkedin.com/in/${vanity}/`,
          name: p.name,
          headline: p.title,
          foundIn: "people",
        },
      ],
      { niche: p.niche },
    );
    c = await contactByHandle(db, "linkedin", vanity);
  }
  if (c.personId !== null && c.companyId !== null) return c;
  // The lead guard reads the person and the firm.
  const [linked] = await db
    .update(reachContacts)
    .set({ personId: c.personId ?? p.id, companyId: c.companyId ?? p.companyId })
    .where(eq(reachContacts.id, c.id))
    .returning();
  return linked ?? c;
}

/**
 * The account a message to `c` goes from: theirs once they have one (LinkedIn only after they
 * accepted), else `reddit@wren`. Refused when they asked to stop, the account isn't live in reach,
 * or another channel holds the lead.
 */
export async function messageAccount(
  db: Queryable,
  c: ReachContact,
  now: Date,
): Promise<ReachAccount> {
  if (["opted_out", "blocked"].includes(c.state)) throw new ReachRefusal("they asked us to stop");
  if (c.platform === "linkedin" && (!c.connectedAt || !c.accountId))
    throw new ReachRefusal("not connected on LinkedIn yet: invite them first");
  const live = (await listAccounts(db, c.platform)).filter(
    (a) => a.state === "active" || a.state === "warming",
  );
  const a = c.accountId
    ? live.find((x) => x.id === c.accountId)
    : live.find((x) => x.account === PERSON_ACCOUNTS[c.platform]);
  if (!a)
    throw new ReachRefusal(
      `${c.accountId ? "their account" : PERSON_ACCOUNTS[c.platform]} isn't live in reach`,
    );
  checkCanDm(a, now);
  const busy = await leadRefusal(db, c, "dm", now);
  if (busy) throw new ReachRefusal(busy);
  return a;
}
