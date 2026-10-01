/**
 * The services agreement: one template, filled with the offer and the terms
 * when it's issued. Plain text with light marks the portal and the email both
 * read: `# ` a title, `## ` a heading, `- ` a list line, blank lines between
 * paragraphs. Changing the wording means a new VERSION; issued agreements keep
 * the text they were issued with.
 */
import { createHash } from "node:crypto";
import type { Offer } from "@wren/offers";
import type { Terms } from "./schema.js";

export const CONTRACT_VERSION = "2026-10-01.3";

/** Who Wren is in law, and where notices go. */
export const WREN_PARTY = {
  name: "William Jin, operating as Wren Automation",
  place: "Toronto, Ontario, Canada",
  email: "william@wrenautomation.com",
} as const;

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** "USD 1,000" or "USD 1,000.50". */
export function amount(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return `${currency} ${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function fees(t: Terms): string[] {
  const out: string[] = [];
  if (t.setupCents > 0)
    out.push(`A setup fee of ${amount(t.setupCents, t.currency)}, invoiced when you sign.`);
  if (t.monthlyCents !== null)
    out.push(
      `${amount(t.monthlyCents, t.currency)} a month while the work runs, invoiced at the start of each month.`,
    );
  if (t.perUnitCents !== null && t.unit)
    out.push(
      `${amount(t.perUnitCents, t.currency)} per ${t.unit}, invoiced each month for the month before${
        t.capCents === null ? "." : `, up to ${amount(t.capCents, t.currency)} in total.`
      }`,
    );
  if (out.length === 0) out.push("None.");
  return out;
}

/** "meeting booked" → "meetings booked". */
const plural = (unit: string) => unit.replace(/^(\S+)/, "$1s");

/** How long it runs: a set time, or until either side ends it; past the time, maybe until a count. */
function length(t: Terms): string {
  if (t.days === null) return "until either side ends it (section 13)";
  const days = `${t.days} days from the start`;
  return t.until && t.unit
    ? `${days}. If there are fewer than ${t.until} ${plural(t.unit)} by then, it carries on until there are ${t.until}, on the same terms and with no new setup fee.`
    : days;
}

/** The full text to issue for this client, offer and terms. */
export function contractText(input: { clientName: string; offer: Offer; terms: Terms }): string {
  const { clientName, offer, terms: t } = input;
  const unit = t.perUnitCents !== null && t.unit ? t.unit : null;
  /** What's counted, for a fee or for how long it runs. */
  const counted = unit ?? (t.until ? t.unit : null);
  const list = (items: readonly string[]) => items.map((i) => `- ${i}`);
  const access = offer.access ?? [];
  const order = [
    `Service: ${offer.name}`,
    `Length: ${length(t)}`,
    `Start: the day you sign${t.setupCents > 0 ? " and the setup invoice is paid, whichever is later" : ""}`,
  ];
  return [
    "# Services agreement",
    `This agreement is between ${WREN_PARTY.name}, of ${WREN_PARTY.place} ("Wren", "we"), and ${clientName} ("you"). It covers the work in the order below. You accept it by signing in your Wren client portal. We sign it by issuing it to you there.`,
    "## The order",
    ...list(order),
    "What we do:",
    ...list(offer.youGet),
    "What you do:",
    ...list(offer.youGive),
    ...(access.length > 0
      ? ["Access we'll ask for (section 5):", ...list(access.map((a) => `${a.system}. ${a.scope}`))]
      : []),
    "Fees:",
    ...list(fees(t)),
    ...(offer.guarantee
      ? ["What you keep, whatever the results:", ...list([offer.guarantee])]
      : []),

    "## 1. The work",
    "We'll do the work in the order with reasonable skill and care, and keep you posted in your portal. We choose how to do it. We may use software, AI tools and people who work for us, and we're responsible for their work under this agreement.",
    "The dates in the plan are our best estimate. When we're waiting on you, they move by the same amount.",

    "## 2. Your part",
    "You'll give us what the order lists, on time, and answer our questions within a reasonable time.",
    "You'll review and approve the messages and templates your portal asks you to approve before anything goes out. Messages sent from a template you approved count as approved by you.",

    "## 3. Your data and the people you contact",
    "- You own the data you give us. You confirm you have the right to share it with us and to have us use it for this work.",
    "- You're responsible for having a lawful basis to contact the people in it, under the laws that apply to you and to them. These include CAN-SPAM and the TCPA in the United States, CASL in Canada, and privacy laws.",
    "- You'll give us a valid postal address for email footers where the law requires one.",
    "- We'll honor every opt-out we receive, stop contacting that person for you, and tell you.",
    "- We use your data only for this work. We don't sell it or use it for anyone else. We protect it with reasonable care, and we'll tell you without undue delay if it's exposed.",
    "- Within 30 days after the work ends we delete your data, unless you ask for it back first or the law requires us to keep it.",

    "## 4. Sending in your name",
    "Messages we send for you go out in your company's name, signed by people at your company who have agreed to it. You let us use their names, your company's name and its logo for this work. Any domain or mailbox we set up for this work is for your use. When the work ends, we transfer it to you or close it, as you choose.",

    "## 5. Access to your systems",
    "We ask for access in your portal, one system at a time, saying how much we need, why, and how to take it back. Access you give us is for this work only. We use the least access that does the job, keep logins private, and change nothing we weren't asked to change.",
    "You can take any access back at any time. Work that needs it pauses until it's restored. We stop using all access when the work ends, and you should remove it then.",

    "## 6. Fees and payment",
    `- We bill through Wise. Each invoice shows in your portal and is due ${t.payDays} days after its date.`,
    ...(t.setupCents > 0
      ? [
          `- The setup fee isn't refundable once the work has started${t.refundIfNone ? ", except as the next point says" : ""}.`,
        ]
      : []),
    ...(t.refundIfNone && t.days !== null && t.unit
      ? [
          `- If there are no ${plural(t.unit)} by day ${t.days}, we refund every fee you've paid us under this agreement. This applies if you gave us at least ${t.refundIfNone.minContacts} contacts whose email addresses pass our checks, approved each message or template within 5 business days of our asking, and didn't take back access we needed or ask us to pause. Ask for it within 30 days after day ${t.days}. We pay it within 14 days, and the work ends then.`,
        ]
      : []),
    ...(counted
      ? [
          `- A ${counted} is a meeting on your calendar with someone we reached for you. It counts once per person. If they don't turn up and it isn't rebooked within 14 days, it doesn't count.`,
        ]
      : []),
    ...(unit
      ? [
          `- Each ${unit} is listed in your portal as it happens, so you can check it before it's invoiced. If you think one shouldn't count, tell us within 14 days of the invoice and we'll settle it in good faith.`,
        ]
      : []),
    "- Fees don't include taxes. You pay any sales, use or similar taxes on them, apart from taxes on our income.",
    "- If an invoice is more than 14 days late, we may pause the work until it's paid. We'll tell you first.",

    "## 7. Results",
    `Replies, meetings and hires depend on people and markets neither of us controls, so we don't promise any number of them${t.refundIfNone ? ", apart from the refund in section 6" : ""}. What the order says you keep, you keep whatever the results.`,

    "## 8. Who owns what",
    "- You own your data, and what we make for you alone once it's paid for, such as your cleaned lists and your copy.",
    "- We keep our software, prompts, templates, methods and know-how, including improvements we make while working for you. Where any of it is part of what we hand over, you may use it for your own business.",
    "- We won't name you as a client or share your results without your written OK. We may use what we learn in a general way that doesn't identify you or your contacts.",

    "## 9. Confidentiality",
    "Each of us will keep the other's non-public information private, use it only for this agreement, and share it only with people who need it for this work and are bound to keep it private. This doesn't cover information that is public, that the other side already had, or that it got lawfully from someone else. Either of us may disclose what a court or the law requires, after warning the other where that's allowed.",
    "This lasts for 3 years after the agreement ends. For personal data and trade secrets, it lasts as long as they stay private.",

    "## 10. Warranties",
    "Apart from what this agreement says, we provide the work as is. To the extent the law allows, we give no other promises, written or implied, including any about merchantability, fitness for a particular purpose, or uninterrupted or error-free service.",

    "## 11. Limits on liability",
    "- Neither of us is liable to the other for indirect, special, incidental or consequential losses, or for lost profits, revenue, business or data, even if warned they were possible.",
    "- Our total liability under this agreement is limited to the fees you paid us in the 3 months before the event that caused the claim.",
    "- These limits don't apply to your duty to pay fees, to your promises in section 12, or where the law doesn't allow them.",

    "## 12. Claims from others",
    "You'll defend us and cover our reasonable costs, including legal fees, damages and fines, for any claim by someone else that comes from your data, messages you approved, your instructions, or your breach of section 3. We'll tell you promptly about such a claim and let you run the defence, and we won't settle it without your OK.",

    "## 13. Ending it",
    "- Either of us can end this agreement with 14 days' written notice. Email counts.",
    "- Either of us can end it at once if the other breaks it and doesn't fix it within 7 days of being told, or can't pay its debts.",
    `- When it ends, you pay for the work done up to the end.${
      unit
        ? ` Fees per ${unit} are also due for each one in the 30 days after the end with someone we reached before it.`
        : ""
    }`,
    "- Sections 3, 6, 8 to 12, 13 and 14 still apply after it ends.",

    "## 14. General",
    "- We're independent businesses. Neither of us can act or sign for the other.",
    "- Neither of us is liable for delays caused by events outside reasonable control, such as outages at email or internet providers.",
    "- The laws of Ontario and the federal laws of Canada that apply there govern this agreement. The courts in Toronto, Ontario decide any dispute about it, and we both accept them.",
    "- This agreement, with its order, is everything we agreed about this work. It replaces earlier proposals and emails. Changes need writing both of us accept, such as a new agreement signed in your portal.",
    "- If a court finds part of it unenforceable, the rest still applies, and that part applies as far as the law allows.",
    "- Neither of us may assign it without the other's OK, except that we may assign it to a company we form or to whoever takes over our business.",
    `- Notices go by email: to ${WREN_PARTY.email} for us, and to the signer's email for you.`,
    "- Signing electronically binds us both like a signature on paper. By signing, you agree to receive this agreement and notices about it by email.",
    "- If one of us doesn't enforce a term right away, it can still enforce it later.",
  ].join("\n\n");
}
