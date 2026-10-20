/**
 * What the workspace knows of a person for scoring their fit to an offer's ICP
 * (`@wren/pipeline` `scoreFit`): free reads of rows we hold, no network. A trait we do not know is
 * left out, so the scorer calls it unknown and never counts it against the person.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { firmOf, type ProfileFacts } from "./profile-research.js";

/** The traits, in the shape `scoreFit` reads (`FitTraits`); a plain copy, so this package imports nothing of the pipeline. */
export interface PersonTraits {
  /** Title and seniority: "Owner at Acme Dental", "owner". */
  roles?: string[];
  industries?: string[];
  /** The people map's size word: solo, small, mid, large. */
  size?: string;
  /** The firm's country code. */
  regions?: string[];
  /** Plain lines a model may read: no name, no address. */
  about: string[];
}

const known = (v: string | null | undefined) => {
  const s = v?.trim();
  return s && s !== "unknown" ? s : null;
};

export async function fitTraitsOf(
  db: Queryable,
  profile: number,
  facts: ProfileFacts,
): Promise<PersonTraits> {
  const [firm] = (await db.execute(sql`
    select co.niche, co.country
    from profile_keys k
    join people p on p.id = case when k.value ~ '^[0-9]{1,9}$' then k.value::int end
    join companies co on co.id = p.company_id
    where k.profile_id = ${profile} and k.kind = 'person'
    order by k.id limit 1`)) as unknown as { niche: string | null; country: string | null }[];
  const [persona] = (await db.execute(sql`
    select persona_role, persona_niche, persona_size from profile_rollups
    where profile_id = ${profile}`)) as unknown as {
    persona_role: string | null;
    persona_niche: string | null;
    persona_size: string | null;
  }[];
  const title = known(facts.person?.title) ?? known(facts.employers[0]);
  const seniority = known(persona?.persona_role);
  const niche = known(firm?.niche) ?? known(persona?.persona_niche);
  const size = known(persona?.persona_size);
  const country = known(firm?.country);
  const company = firmOf(facts).name;
  const roles = [title, seniority].filter((v): v is string => v !== null);
  return {
    ...(roles.length ? { roles } : {}),
    ...(niche ? { industries: [niche] } : {}),
    ...(size ? { size } : {}),
    ...(country ? { regions: [country] } : {}),
    about: [
      title ? `Role: ${title}${company ? ` at ${company}` : ""}` : null,
      seniority ? `Seniority: ${seniority}` : null,
      niche ? `Industry: ${niche}` : null,
      size ? `Company size: ${size}` : null,
      country ? `Country: ${country}` : null,
    ].filter((v): v is string => v !== null),
  };
}
