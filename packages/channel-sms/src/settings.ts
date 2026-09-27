/** Settings → the channel's policy objects and provider: one place, shared by the worker and the CLI. */
import type { Settings } from "@wren/config";
import { DEFAULT_HEALTH, type HealthPolicy } from "./health.js";
import { parseClock, type SmsPolicy } from "./policy.js";
import { FakeProvider, type SmsProvider } from "./provider.js";
import { TelnyxProvider } from "./telnyx.js";

export function policyFrom(s: Settings): SmsPolicy {
  const [start, end] = s.smsWindow.split("-") as [string, string];
  return {
    windowStartMinute: parseClock(start),
    windowEndMinute: parseClock(end),
    days: s.smsDays,
    dailyCap: s.smsDailyCap,
    numberCap: s.smsNumberCap,
    rampStart: s.smsRampStart,
    rampStep: s.smsRampStep,
    rampEveryDays: s.smsRampEveryDays,
    gapSeconds: s.smsGapSeconds,
    maxNumbers: s.smsMaxNumbers,
    bases: s.smsBases,
  };
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
  if (s.smsProvider === "fake") {
    // One fictional (555-01xx) number, so `numbers sync` gives a local stack a pool to send from.
    const fake = new FakeProvider();
    fake.numbers = [{ e164: "+12015550100", providerId: "fake-1" }];
    return fake;
  }
  if (!s.telnyxApiKey) throw new Error("WREN_SMS_PROVIDER=telnyx needs WREN_TELNYX_API_KEY");
  return new TelnyxProvider({
    apiKey: s.telnyxApiKey,
    messagingProfileId: s.telnyxMessagingProfileId ?? null,
  });
}
