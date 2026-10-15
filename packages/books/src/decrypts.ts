/**
 * KMS Decrypt calls per principal per day, from CloudTrail's event history
 * (90 days, free for management events). Every SecureString read is one, so a
 * stolen role or login reading the secrets shows here first: a principal that
 * never decrypts, or one decrypting far more than the day before.
 */
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";

/** Decrypts per principal in `[from, to)`. */
export type DecryptFeed = (from: Date, to: Date) => Promise<Map<string, number>>;

interface Identity {
  type?: string;
  userName?: string;
  invokedBy?: string;
  sessionContext?: { sessionIssuer?: { userName?: string } };
}

/** Who asked: the role for an assumed role, the user, `root`, or the calling service. */
export function principalOf(id: Identity | undefined): string {
  if (!id) return "unknown";
  if (id.type === "AssumedRole") return `role/${id.sessionContext?.sessionIssuer?.userName ?? "?"}`;
  if (id.type === "IAMUser") return `user/${id.userName ?? "?"}`;
  if (id.type === "Root") return "root";
  return id.invokedBy ?? id.type ?? "unknown";
}

/** LookupEvents allows 2 calls a second per account; pages are 50 events. */
const PAGE_GAP_MS = 600;

export function cloudTrailDecrypts(
  client: CloudTrailClient = new CloudTrailClient({ region: "us-east-1" }),
): DecryptFeed {
  return async (from, to) => {
    const counts = new Map<string, number>();
    let token: string | undefined;
    do {
      const page = await client.send(
        new LookupEventsCommand({
          LookupAttributes: [{ AttributeKey: "EventName", AttributeValue: "Decrypt" }],
          StartTime: from,
          EndTime: to,
          MaxResults: 50,
          NextToken: token,
        }),
      );
      for (const e of page.Events ?? []) {
        const body = e.CloudTrailEvent ? JSON.parse(e.CloudTrailEvent) : {};
        if (body.eventSource !== "kms.amazonaws.com") continue;
        const who = principalOf(body.userIdentity);
        counts.set(who, (counts.get(who) ?? 0) + 1);
      }
      token = page.NextToken;
      if (token) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
    } while (token);
    return counts;
  };
}

/** A jump is this many times the day before... */
export const DECRYPT_FACTOR = 3;
/** ...and at least this many calls; a principal new since the day before needs only this. */
export const DECRYPT_FLOOR = 50;

export interface DecryptSpike {
  principal: string;
  count: number;
  before: number;
}

/** Principals whose decrypts on a day jumped past the day before, most first. */
export function decryptSpikes(
  day: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, number>,
): DecryptSpike[] {
  return [...day]
    .map(([principal, count]) => ({ principal, count, before: before.get(principal) ?? 0 }))
    .filter((s) => s.count >= DECRYPT_FLOOR && s.count >= s.before * DECRYPT_FACTOR)
    .sort((a, b) => b.count - a.count);
}
