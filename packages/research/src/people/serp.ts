/**
 * What a search result says about a LinkedIn profile, without opening it.
 * Engines title a profile "Name - Title - Company | LinkedIn" (or "Name -
 * Company", or "Name - Title at Company") and often quote its description,
 * "Experience: Company · Education: … · Location: …".
 */

export interface ProfileLink {
  /** `https://www.linkedin.com/in/<vanity>/`: one spelling per profile. */
  url: string;
  vanity: string;
}

const MEMBER_ID = /^ACo[\w-]{8,}$/;

/** A profile URL on any LinkedIn host (ca.linkedin.com too), canonical; null for anything else. */
export function linkedinProfile(url: string): ProfileLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = /^\/in\/([^/?#]+)/.exec(u.pathname);
  if (!m?.[1]) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  // Vanity names are case-blind; member ids (ACoAA…) are not.
  const vanity = encodeURIComponent(MEMBER_ID.test(raw) ? raw : raw.toLowerCase());
  if (!/^[a-z0-9_%-]{2,100}$/i.test(vanity)) return null;
  return { url: `https://www.linkedin.com/in/${vanity}/`, vanity };
}

export interface SerpProfile {
  name: string;
  title: string | null;
  /** The current employer as the result states it; null when it does not. */
  company: string | null;
  /**
   * The lone part of "Name - X" when X is not a role: an employer, a headline
   * or a place, the title cannot say which. Trust it only as the firm itself.
   */
  bare: string | null;
}

/** Words that make a line a role, not a firm ("Jane Doe - Senior Recruiter | LinkedIn"). */
const ROLE =
  /\b(recruit\w*|sourc\w*|talent|manager|director|head|lead|vp|vice president|president|chief|ceo|cfo|coo|cto|cmo|chro|founder|owner|partner|principal|consultant|specialist|coordinator|associate|analyst|engineer|developer|designer|architect|scientist|researcher|nurse|physician|doctor|teacher|professor|accountant|attorney|lawyer|counsel|paralegal|writer|editor|administrator|assistant|representative|technician|operator|officer|executive|advisor|adviser|agent|broker|sales|marketing|operations|hr|human resources|people|retired|student|intern|freelance\w*|self.employed)\b/i;
/** "Former Recruiter at Acme": where they were, not where they are. */
const PAST = /^(former|formerly|ex|previously|past|retired)\b/i;
/** Engines cut long titles: "Acme Staff..." is not a firm. */
const CUT = /(\.\.\.|…)$/;

export function readSerpTitle(raw: string): SerpProfile | null {
  // "| LinkedIn" and anything after a pipe ("| Talent Acquisition", "|
  // Professional Profile") is headline or engine chrome, never the employer.
  const t = raw
    .replace(/\s*[|\-–—]\s*LinkedIn\s*$/i, "")
    .split(/\s+\|\s+|\s*\|\s*$/)[0]
    ?.trim();
  const [name, ...rest] = (t ?? "")
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name || name.startsWith("|")) return null;
  const blank = { name, title: null, company: null, bare: null };
  if (rest.length >= 2) {
    const company = rest.at(-1) ?? "";
    return {
      ...blank,
      title: rest.slice(0, -1).join(" - "),
      company: CUT.test(company) ? null : company,
    };
  }
  const one = rest[0];
  if (!one) return blank;
  const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(one);
  if (at?.[1] && at[2])
    return { ...blank, title: at[1], company: PAST.test(at[1]) || CUT.test(at[2]) ? null : at[2] };
  if (ROLE.test(one)) return { ...blank, title: one };
  return CUT.test(one) ? blank : { ...blank, bare: one };
}

/** "Experience: Globex · Education: …" -> "Globex". LinkedIn lists the current role first. */
export function experienceOf(snippet: string | null): string | null {
  const m = /\bExperience:\s*([^·|;\n]+?)\s*(?:[·|;\n]|$)/.exec(snippet ?? "");
  const company = m?.[1]?.trim();
  return company && !CUT.test(company) ? company : null;
}
