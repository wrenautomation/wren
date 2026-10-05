/**
 * Verdicts are public facts about an address, kept on main for every client
 * (designs/2026-10-04-outbound-per-client.md, O1). A client's walk asks main
 * first; a fresh probe lands on main too, unattributed, so the next client and
 * the prober's health read both see it. The client's own row is still written
 * by the walk, in the client's database.
 */
import type { Db } from "@wren/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { verifications } from "../schema.js";
import type { EmailVerifier, Verdict } from "./verifier.js";

/** How long a shared verdict answers for an address. Risky is never reused: it is often about us, not them. */
export const SHARED_VERDICT_DAYS = 30;

export function sharedVerdicts(main: Db, inner: EmailVerifier): EmailVerifier {
  return {
    name: inner.name,
    authoritative: inner.authoritative,
    costsCredits: inner.costsCredits,
    async verify(email: string): Promise<Verdict> {
      const since = new Date(Date.now() - SHARED_VERDICT_DAYS * 86_400_000);
      const [known] = await main
        .select({ result: verifications.result, raw: verifications.raw })
        .from(verifications)
        .where(
          and(
            eq(verifications.email, email),
            eq(verifications.verifier, inner.name),
            inArray(verifications.result, ["valid", "invalid", "catch_all"]),
            gt(verifications.checkedAt, since),
          ),
        )
        .orderBy(desc(verifications.checkedAt))
        .limit(1);
      if (known) return { result: known.result, raw: { ...(known.raw as object), shared: true } };
      const verdict = await inner.verify(email);
      await main.insert(verifications).values({
        email,
        verifier: inner.name,
        result: verdict.result,
        raw: verdict.raw,
      });
      return verdict;
    },
  };
}
