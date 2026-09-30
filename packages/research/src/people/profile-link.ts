/** One LinkedIn profile, however a link to it was spelled. */

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
