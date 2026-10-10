/**
 * Message and Invite from People (designs/2026-10-06-content-desk.md, "Message from People"): a
 * person we hold (`li:<people.id>` with a LinkedIn page, `reddit:<handle>` read from Reddit,
 * `linkedin:<vanity>` seen only through a touch) becomes a reach contact (`found_in = people`) on
 * first use. Message goes from `linkedin@wren` once they accepted, or from `reddit@wren` to
 * anyone; Invite queues `linkedin-invite` for them now. Follow (LinkedIn, X, Instagram) is a
 * site call from the comments account, kept as a touch.
 */
import { leadRefusal } from "@wren/core/leads";
import { handleOf } from "@wren/core/outreach";
import { companies, people } from "@wren/core/schema";
import { normalizeHandle, recordTouch, socialHandles, touches } from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { listAccounts } from "./accounts.js";
import { checkCanDm } from "./comments.js";
import { addProspects, contactByHandle } from "./contacts.js";
import { ReachRefusal } from "./refusal.js";
import {
  isReachPlatform,
  type Platform,
  REACH_POST_PLATFORMS,
  type ReachAccount,
  type ReachContact,
  type ReachPostPlatform,
  reachContacts,
} from "./schema.js";
import { keepTouch } from "./touches.js";

const isPostPlatform = (p: string): p is ReachPostPlatform =>
  (REACH_POST_PLATFORMS as readonly string[]).includes(p);

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
  if (kind === "linkedin") {
    // A LinkedIn page seen only through a touch (designs/2026-10-07-touches.md): its vanity.
    const vanity = /^[^\s/?#:]{1,100}$/.test(ref) ? ref.toLowerCase() : null;
    if (!vanity) throw new ReachRefusal("that person has no LinkedIn page we can write to");
    const known = await contactLike(db, "linkedin", vanity);
    if (known) return known;
    await addProspects(db, "linkedin", [
      {
        handle: vanity,
        url: `https://www.linkedin.com/in/${vanity}/`,
        name: null,
        headline: null,
        foundIn: "people",
      },
    ]);
    return contactByHandle(db, "linkedin", vanity);
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
  const platform = c.platform;
  if (!isReachPlatform(platform))
    throw new ReachRefusal("this DM answers through the client's connected account");
  if (c.platform === "linkedin" && (!c.connectedAt || !c.accountId))
    throw new ReachRefusal("not connected on LinkedIn yet: invite them first");
  const live = (await listAccounts(db, platform)).filter(
    (a) => a.state === "active" || a.state === "warming",
  );
  const a = c.accountId
    ? live.find((x) => x.id === c.accountId)
    : live.find((x) => x.account === PERSON_ACCOUNTS[platform]);
  if (!a)
    throw new ReachRefusal(
      `${c.accountId ? "their account" : PERSON_ACCOUNTS[platform]} isn't live in reach`,
    );
  checkCanDm(a, now);
  const busy = await leadRefusal(db, c, "dm", now);
  if (busy) throw new ReachRefusal(busy);
  return a;
}

/** Who Follow on a People row follows: the platform and the handle it keys on. */
export interface FollowTarget {
  platform: ReachPostPlatform;
  handle: string;
  name: string | null;
  url: string | null;
  personId: number | null;
}

/**
 * Follow from People: LinkedIn, X and Instagram. Refused for any other site, a handle the follow
 * call can't use (a URN, an X user id), someone who asked us to stop, or one we follow already.
 */
export async function personFollow(db: Queryable, id: string): Promise<FollowTarget> {
  const at = id.indexOf(":");
  const [kind, ref] = [id.slice(0, at), id.slice(at + 1)];
  let t: FollowTarget;
  if (kind === "li") {
    const [p] = await db
      .select({ id: people.id, name: people.fullName, url: people.linkedinUrl })
      .from(people)
      .where(eq(people.id, Number(ref)));
    const vanity = /linkedin\.com\/in\/([^/?#]+)/i.exec(p?.url ?? "")?.[1]?.toLowerCase();
    if (!p || !vanity) throw new ReachRefusal("that person has no LinkedIn page");
    t = { platform: "linkedin", handle: vanity, name: p.name, url: p.url, personId: p.id };
  } else {
    if (!isPostPlatform(kind))
      throw new ReachRefusal("Follow is on LinkedIn, X and Instagram only");
    const h = normalizeHandle(kind, ref)?.handle;
    if (!h || h.includes(":")) throw new ReachRefusal(`no ${kind} username to follow`);
    const [known] = await db
      .select({
        url: socialHandles.url,
        name: socialHandles.name,
        personId: socialHandles.personId,
      })
      .from(socialHandles)
      .where(and(eq(socialHandles.platform, kind), eq(socialHandles.handle, h)));
    t = {
      platform: kind,
      handle: h,
      name: known?.name ?? null,
      url: known?.url ?? null,
      personId: known?.personId ?? null,
    };
  }
  const c = isReachPlatform(t.platform) ? await contactLike(db, t.platform, t.handle) : null;
  if (c && ["opted_out", "blocked"].includes(c.state))
    throw new ReachRefusal("they asked us to stop");
  const [followed] = await db
    .select({ id: touches.id })
    .from(touches)
    .innerJoin(socialHandles, eq(socialHandles.id, touches.handleId))
    .where(
      and(
        eq(socialHandles.platform, t.platform),
        eq(socialHandles.handle, t.handle),
        eq(touches.kind, "follow"),
        eq(touches.direction, "ours"),
      ),
    )
    .limit(1);
  if (followed) throw new ReachRefusal("already following");
  return t;
}

/** Followed: kept as our follow touch on them. */
export async function markFollowed(
  db: Queryable,
  t: FollowTarget,
  o: { account: string; at: Date },
): Promise<void> {
  await keepTouch(`follow:${t.platform}:${t.handle}`, () =>
    recordTouch(db, {
      platform: t.platform,
      handle: t.handle,
      name: t.name,
      personId: t.personId,
      kind: "follow",
      direction: "ours",
      account: o.account,
      url: t.url,
      at: o.at,
      source: "people",
      ref: `follow:${t.platform}:${t.handle}`,
    }),
  );
}
