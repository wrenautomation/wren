import { companies } from "@wren/core";
import type { Db } from "@wren/db";
import { documents } from "@wren/research/schema";
import { DEFAULT_POLICY, type SmsPolicy } from "../../src/policy.js";
import type { FakeProvider } from "../../src/provider.js";
import { smsNumbers } from "../../src/schema.js";
import { checkSequence, type SmsSequence } from "../../src/templates.js";

export const TABLES = [
  "sms_events",
  "sms_messages",
  "sms_contacts",
  "sms_numbers",
  "suppression_events",
  "suppressions",
  "documents",
  "people",
  "companies",
  "runs",
  "llm_calls",
];

export const SEQ: SmsSequence = checkSequence({
  name: "agencies-sms",
  steps: [
    {
      step: 1,
      afterDays: 0,
      body: "hi {first_name|there}, {sender} here. saw {company|your site}. reply STOP to opt out",
    },
    { step: 2, afterDays: 3, body: "{sender} again, worth a quick chat?" },
  ],
});
export const SEQUENCES = new Map([[SEQ.name, SEQ]]);

/** Every basis on, tiny ramp, no gap: tests pick what they need. */
export const POLICY: SmsPolicy = {
  ...DEFAULT_POLICY,
  bases: ["published", "opt_in"],
  gapSeconds: 0,
};

// Tue 2026-09-29 18:00Z = 14:00 ET = 11:00 PT: open everywhere.
export const OPEN = new Date("2026-09-29T18:00:00Z");
// Tue 2026-09-29 12:30Z = 08:30 ET: shut.
export const SHUT = new Date("2026-09-29T12:30:00Z");

export async function company(
  db: Db,
  name: string,
  opts: { niche?: string; timezone?: string; html?: string; text?: string } = {},
): Promise<number> {
  const [c] = await db
    .insert(companies)
    .values({
      name,
      domain: `${name.toLowerCase().replace(/\W+/g, "")}.test`,
      niche: opts.niche ?? "agencies",
      ...(opts.timezone ? { timezone: opts.timezone } : {}),
    })
    .returning({ id: companies.id });
  const id = c?.id as number;
  if (opts.html !== undefined || opts.text !== undefined) {
    await db.insert(documents).values({
      companyId: id,
      url: `https://${name.toLowerCase().replace(/\W+/g, "")}.test/contact`,
      kind: "webpage",
      contentHash: `h-${id}`,
      text: opts.text ?? "",
      html: opts.html ?? null,
    });
  }
  return id;
}

export async function numbers(
  db: Db,
  provider: FakeProvider,
  e164s: string[],
  rampStartedOn = "2026-09-01",
) {
  provider.numbers = e164s.map((e164, i) => ({ e164, providerId: `n${i}` }));
  for (const e164 of e164s) {
    await db.insert(smsNumbers).values({ e164, provider: "fake", providerId: e164, rampStartedOn });
  }
}

export function notes() {
  const seen: { title: string; body: string; level?: string }[] = [];
  return {
    seen,
    notifier: {
      name: "test",
      notify: async (title: string, body = "", level?: "info" | "warning") => {
        seen.push({ title, body, ...(level ? { level } : {}) });
        return true;
      },
    },
  };
}
