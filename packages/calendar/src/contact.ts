/**
 * "Or message me directly": a client's own contact links on its booking page, from the part's
 * `contact` settings. Every field is optional and blank by default; with none set the page shows
 * no row. A field that doesn't read is refused at save, so the page only ever links what parsed.
 */
import { z } from "zod";

export type ContactKind = "email" | "phone" | "instagram" | "x" | "linkedin";
export interface ContactLink {
  kind: ContactKind;
  /** What the page shows: the address, the number, the @handle, or "LinkedIn". */
  label: string;
  href: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9 ().-]{7,20}$/;
const HANDLE = /^@?[A-Za-z0-9_.]{1,30}$/;
const LINKEDIN = /^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_%-]{1,100}\/?$/;

const field = (ok: RegExp, title: string, says: string, describe: string) =>
  z
    .string()
    .trim()
    .default("")
    .refine((s) => s === "" || ok.test(s), says)
    .describe(describe)
    .meta({ title });

export const contactSchema = z
  .object({
    email: field(EMAIL, "Email", "an email address", "Your email; blank hides it"),
    phone: field(PHONE, "Phone", "a phone number, like +1 416 555 0100", "Your phone, optional"),
    instagram: field(
      HANDLE,
      "Instagram handle",
      "an Instagram handle, like @acme",
      "Your Instagram handle",
    ),
    x: field(HANDLE, "X handle", "an X handle, like @acme", "Your X handle"),
    linkedin: field(
      LINKEDIN,
      "LinkedIn page",
      "a LinkedIn link, like https://www.linkedin.com/company/acme",
      "Your LinkedIn page's link",
    ),
  })
  .strict()
  .describe("Links under the open times, so people can message you directly");

const handle = (s: string) => s.replace(/^@/, "");

/** The links to show, in a fixed order; none for a block that is blank or doesn't parse. */
export function contactLinks(block: unknown): ContactLink[] {
  const got = contactSchema.safeParse(block ?? {});
  if (!got.success) return [];
  const c = got.data;
  const out: ContactLink[] = [];
  if (c.email) out.push({ kind: "email", label: c.email, href: `mailto:${c.email}` });
  if (c.phone)
    out.push({ kind: "phone", label: c.phone, href: `tel:${c.phone.replace(/[^+0-9]/g, "")}` });
  if (c.instagram)
    out.push({
      kind: "instagram",
      label: `@${handle(c.instagram)}`,
      href: `https://www.instagram.com/${handle(c.instagram)}`,
    });
  if (c.x) out.push({ kind: "x", label: `@${handle(c.x)}`, href: `https://x.com/${handle(c.x)}` });
  if (c.linkedin) out.push({ kind: "linkedin", label: "LinkedIn", href: c.linkedin });
  return out;
}
