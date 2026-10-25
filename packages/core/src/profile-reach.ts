/**
 * How to reach a profile and who it is, for the person page (designs/2026-10-17-people-depth.md):
 * every email, phone and `handle:<platform>` key as a link, and the title, company and LinkedIn
 * page of the research row (`people`) its `person` key names. Read in SQL here because core
 * imports no channel; Outreach's person lists show the same row's columns.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { handleUrl, PLATFORM_LABELS } from "./touches.js";

/** One handle on one site, with its page when we can say it. */
interface ReachHandle {
  platform: string;
  /** "LinkedIn". */
  label: string;
  handle: string;
  /** Their page; null where the site gives none (a LinkedIn URN with no known vanity). */
  url: string | null;
  /** The name the site shows, when we hold it. */
  name: string | null;
}

/** The research row behind a profile's `person` key. */
interface ReachPerson {
  name: string;
  title: string | null;
  company: string | null;
  /** "On LinkedIn". */
  linkedinUrl: string | null;
}

export interface ProfileReach {
  emails: string[];
  phones: string[];
  handles: ReachHandle[];
  person: ReachPerson | null;
}

/** The vanity page in a LinkedIn address, normalized; null when it names none. */
export function linkedinPage(url: string | null | undefined): string | null {
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(url ?? "");
  return m?.[1] ? `https://www.linkedin.com/in/${m[1].toLowerCase()}/` : null;
}

const labelOf = (platform: string) => PLATFORM_LABELS[platform] ?? platform;

/** A profile's addresses as links, and the research person its `person` key names. */
export async function reachOf(db: Queryable, profileId: number): Promise<ProfileReach> {
  const keys = (await db.execute<{ kind: string; value: string }>(sql`
    select kind, value from profile_keys
    where profile_id = ${profileId}
      and (kind in ('email', 'phone', 'person') or kind like 'handle:%')
    order by first_seen, id`)) as unknown as { kind: string; value: string }[];
  const handleKeys = keys.filter((k) => k.kind.startsWith("handle:"));
  const stored = handleKeys.length
    ? ((await db.execute<{
        platform: string;
        handle: string;
        url: string | null;
        name: string | null;
        person_id: number | null;
      }>(sql`
        select platform, handle, url, name, person_id from social_handles
        where (platform, handle) in (${sql.join(
          handleKeys.map((k) => sql`(${k.kind.slice(7)}, ${k.value})`),
          sql`, `,
        )})`)) as unknown as {
        platform: string;
        handle: string;
        url: string | null;
        name: string | null;
        person_id: number | null;
      }[])
    : [];
  // The research row: the `person` key, else the person a handle was linked to.
  const personId =
    Number(keys.find((k) => k.kind === "person")?.value) ||
    stored.find((h) => h.person_id)?.person_id ||
    null;
  const [row] = personId
    ? ((await db.execute<{
        full_name: string;
        title: string | null;
        company: string | null;
        linkedin_url: string | null;
      }>(sql`
        select p.full_name, p.title, co.name company, p.linkedin_url
        from people p left join companies co on co.id = p.company_id
        where p.id = ${personId}`)) as unknown as {
        full_name: string;
        title: string | null;
        company: string | null;
        linkedin_url: string | null;
      }[])
    : [];
  const vanity = linkedinPage(row?.linkedin_url);
  const handles = handleKeys.map((k): ReachHandle => {
    const platform = k.kind.slice(7);
    const got = stored.find((h) => h.platform === platform && h.handle === k.value);
    // A LinkedIn URN links only once the person's vanity page is known.
    const url =
      got?.url ??
      handleUrl(platform, k.value) ??
      (platform === "linkedin" && k.value.startsWith("urn:") ? vanity : null);
    return { platform, label: labelOf(platform), handle: k.value, url, name: got?.name ?? null };
  });
  return {
    emails: keys.filter((k) => k.kind === "email").map((k) => k.value),
    phones: keys.filter((k) => k.kind === "phone").map((k) => k.value),
    handles,
    person: row
      ? {
          name: row.full_name,
          title: row.title,
          company: row.company,
          linkedinUrl: vanity ?? row.linkedin_url,
        }
      : null,
  };
}
