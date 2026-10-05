import { senderMatches } from "@wren/core/mailbox";
import type { MailSpec, VendorSpec } from "./chart.js";

export {
  type DelegatedGmail,
  delegatedMailbox,
  type Mailbox,
  siteMailbox,
} from "@wren/core/mailbox";

const quoted = (term: string) => (/\s/.test(term) ? `"${term}"` : term);

/** One vendor's billing mail as a Gmail search clause. */
export function mailClause(mail: MailSpec): string {
  const from = mail.from.map((f) => `from:${f}`);
  const sender = from.length === 1 ? (from[0] as string) : `(${from.join(" OR ")})`;
  if (!mail.subject?.length) return sender;
  return `${sender} subject:(${mail.subject.map(quoted).join(" OR ")})`;
}

/** Every known vendor's billing mail since a day, as one search. */
export function billingQuery(vendorSpecs: readonly VendorSpec[], since: string): string {
  const after = since.replaceAll("-", "/");
  return `after:${after} {${vendorSpecs.map((v) => `(${mailClause(v.mail)})`).join(" ")}}`;
}

/** The vendor a message came from, by the same rules the search used; null when none. */
export function vendorFor(
  vendorSpecs: readonly VendorSpec[],
  fromAddress: string,
  subject: string,
): VendorSpec | null {
  const s = subject.toLowerCase();
  for (const v of vendorSpecs) {
    if (!v.mail.from.some((f) => senderMatches(fromAddress, f))) continue;
    if (!v.mail.subject?.length || v.mail.subject.some((w) => s.includes(w.toLowerCase())))
      return v;
  }
  return null;
}
