/** Settings → the channel's policy objects and provider: one place, shared by the worker and the CLI. */
import type { Settings } from "@wren/config";
import { DEFAULT_HEALTH, type HealthPolicy } from "./health.js";
import { LinqProvider } from "./linq.js";
import { COUNTRY_ZONES } from "./phone.js";
import { parseClock, type SmsPolicy } from "./policy.js";
import { FakeProvider, NoProvider, type SmsProvider } from "./provider.js";
import { type Pusher, WebPusher } from "./push.js";
import { TelnyxProvider } from "./telnyx.js";

export function policyFrom(s: Settings): SmsPolicy {
  const [start, end] = s.smsWindow.split("-") as [string, string];
  const [askedStart, askedEnd] = s.smsFormWindow.split("-") as [string, string];
  return {
    asked: {
      windowStartMinute: parseClock(askedStart),
      windowEndMinute: parseClock(askedEnd),
      days: s.smsFormDays,
    },
    windowStartMinute: parseClock(start),
    windowEndMinute: parseClock(end),
    days: s.smsDays,
    dailyCap: s.smsDailyCap,
    monthlyPerContact: s.smsMonthlyPerContact,
    numberCap: s.smsNumberCap,
    rampStart: s.smsRampStart,
    rampStep: s.smsRampStep,
    rampEveryDays: s.smsRampEveryDays,
    gapSeconds: s.smsGapSeconds,
    maxNumbers: s.smsMaxNumbers,
    bases: s.smsBases,
  };
}

/**
 * The countries a site applicant may be texted in. Each beyond the US and Canada needs its one
 * clock in COUNTRY_ZONES, so a text there lands in their hours: a loud error at start if not.
 */
export function formCountriesFrom(s: Pick<Settings, "smsFormCountries">): readonly string[] {
  for (const c of s.smsFormCountries)
    if (c !== "US" && c !== "CA" && !COUNTRY_ZONES[c])
      throw new Error(
        `WREN_SMS_FORM_COUNTRIES has ${c}, which has no single time zone in channel-sms COUNTRY_ZONES`,
      );
  return s.smsFormCountries;
}

export function healthFrom(s: Settings): HealthPolicy {
  return {
    ...DEFAULT_HEALTH,
    maxFailRate: s.smsMaxFailRate,
    maxFleetOptOutRate: s.smsMaxOptOutRate,
    lowBalanceUsd: s.smsLowBalanceUsd,
  };
}

/** The configured provider. Telnyx without its key is a loud error at start, not at the first send. */
export function providerFrom(s: Settings): SmsProvider {
  if (s.smsProvider === "none") return new NoProvider();
  if (s.smsProvider === "fake") {
    // One fictional (555-01xx) number, so `numbers sync` gives a local stack a pool to send from.
    const fake = new FakeProvider();
    fake.numbers = [{ e164: "+12015550100", providerId: "fake-1" }];
    return fake;
  }
  if (s.smsProvider === "linq") {
    if (!s.linqApiKey) throw new Error("WREN_SMS_PROVIDER=linq needs WREN_LINQ_API_KEY");
    return new LinqProvider({ apiKey: s.linqApiKey });
  }
  if (!s.telnyxApiKey) throw new Error("WREN_SMS_PROVIDER=telnyx needs WREN_TELNYX_API_KEY");
  return new TelnyxProvider({
    apiKey: s.telnyxApiKey,
    messagingProfileId: s.telnyxMessagingProfileId ?? null,
  });
}

/** Reply alerts on the phone app. Null = no push keys. One key without the other is a loud error at start. */
export function pusherFrom(s: Settings): Pusher | null {
  if (!s.smsPushPublicKey && !s.smsPushPrivateKey) return null;
  if (!s.smsPushPublicKey || !s.smsPushPrivateKey)
    throw new Error(
      "reply alerts need both WREN_SMS_PUSH_PUBLIC_KEY and WREN_SMS_PUSH_PRIVATE_KEY",
    );
  return new WebPusher({
    publicKey: s.smsPushPublicKey,
    privateKey: s.smsPushPrivateKey,
    subject: s.smsPushSubject,
  });
}
