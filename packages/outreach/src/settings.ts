/** The policy from `WREN_REACH_*` settings. */
import type { Settings } from "@wren/config";
import { DEFAULT_POLICY, parseClock, type ReachPolicy } from "./policy.js";

export function policyFrom(s: Settings): ReachPolicy {
  const [start, end] = s.reachWindow.split("-").map(parseClock) as [number, number];
  return {
    ...DEFAULT_POLICY,
    windowStartMinute: start,
    windowEndMinute: end,
    days: s.reachDays,
    gapSeconds: s.reachGapSeconds,
    reddit: { messagesPerDay: s.reachRedditMessagesPerDay },
    linkedin: {
      connectsStart: s.reachLinkedinConnectsStart,
      connectsStep: DEFAULT_POLICY.linkedin.connectsStep,
      rampEveryDays: DEFAULT_POLICY.linkedin.rampEveryDays,
      connectsCap: s.reachLinkedinConnectsCap,
      messagesPerDay: s.reachLinkedinMessagesPerDay,
      notesPerMonth: DEFAULT_POLICY.linkedin.notesPerMonth,
    },
  };
}
