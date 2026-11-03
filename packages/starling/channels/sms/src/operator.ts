/**
 * Texts to William: a `Notifier` that sends the ping to his phone from one of our
 * numbers in his country (a number texts its own country only; a US one only once
 * registered). Never a lead, never a sequence, never counted against a contact's cap.
 */
import type { Notifier, NotifyLevel } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { countryOf } from "./phone.js";
import type { SmsProvider } from "./provider.js";
import { smsNumbers } from "./schema.js";

/** About four SMS parts: enough for their words and the approve line. */
const TEXT_LIMIT = 600;

export class SmsNotifier implements Notifier {
  readonly name = "sms";
  constructor(
    private readonly db: Queryable,
    private readonly provider: SmsProvider,
    /** William's phone, E.164. */
    private readonly to: string,
    private readonly log: (line: string) => void = console.warn,
  ) {}

  async notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean> {
    const from = await this.from();
    if (!from) {
      this.log(`sms notify skipped: no active number in ${countryOf(this.to) ?? "?"}`);
      return false;
    }
    const text = `${level === "warning" ? "! " : ""}${title}${body ? `\n${body}` : ""}`
      .replaceAll("**", "")
      .slice(0, TEXT_LIMIT);
    try {
      const sent = await this.provider.send({ from, to: this.to, text });
      if (!sent.ok) this.log(`sms notify failed: ${sent.detail}`);
      return sent.ok;
    } catch (err) {
      this.log(`sms notify failed: ${err instanceof Error ? err.name : "error"}`);
      return false;
    }
  }

  private async from(): Promise<string | null> {
    const country = countryOf(this.to);
    if (!country) return null;
    const [row] = await this.db
      .select({ e164: smsNumbers.e164 })
      .from(smsNumbers)
      .where(
        and(
          eq(smsNumbers.state, "active"),
          eq(smsNumbers.country, country),
          or(eq(smsNumbers.country, "CA"), isNotNull(smsNumbers.registeredAt)),
        ),
      )
      .orderBy(asc(smsNumbers.id))
      .limit(1);
    return row?.e164 ?? null;
  }
}
