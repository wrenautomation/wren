/**
 * What a journey's node `research` runs (packages/pipeline/src/research.ts), from the research
 * code that exists. `light` reads the workspace's own rows: role, firm, address verdicts. `full`
 * is the person-research run (`ProfileResearch`), queued and sent without waiting. That run is
 * Wren's own People only, so a client's `full` is skipped with a note. No new paid calls.
 */
import { abandonProfileResearch, queueProfileResearch } from "@wren/core/profile-findings";
import { PortalRefusal } from "@wren/core/refusal";
import { type Ingress, ingressSend } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { Researcher } from "@wren/pipeline/research";
import { firmOf, readProfileFacts } from "@wren/research/people";
import { sql } from "drizzle-orm";

export interface JourneyResearchDeps {
  /** Wren's database, where the person-research run lives. */
  main: Db;
  ingress: Ingress;
}

export function journeyResearcher(d: JourneyResearchDeps): Researcher {
  return {
    async light(db, ask) {
      const facts = await readProfileFacts(db, ask.profile);
      const firm = firmOf(facts);
      // The address verdicts we already hold; the view lives with the email channel.
      const verdicts: { email: string; result: string }[] = [];
      const [view] = (await db.execute(
        sql`select to_regclass('latest_verifications') as name`,
      )) as unknown as { name: string | null }[];
      if (view?.name && facts.emails.length) {
        verdicts.push(
          ...((await db.execute(sql`
            select email, result from latest_verifications
            where email in (${sql.join(
              facts.emails.map((e) => sql`${e}`),
              sql`, `,
            )})`)) as unknown as { email: string; result: string }[]),
        );
      }
      return {
        role: facts.person?.title ?? facts.employers[0] ?? null,
        firm: firm.name,
        domain: firm.domain,
        verdicts,
        // The offer's ICP, as context. Nothing here scores fit.
        icp: ask.icp,
      };
    },

    async full(ask) {
      if (ask.client)
        return { state: "skipped", note: "Person research runs on Wren's own People only." };
      let queued: { lookupId: number };
      try {
        queued = await queueProfileResearch(d.main, ask.profile, "journey");
      } catch (err) {
        if (err instanceof PortalRefusal && err.status === 409)
          return { state: "skipped", note: err.message };
        throw err;
      }
      try {
        await ingressSend(
          d.ingress,
          { service: "ProfileResearch", key: String(ask.profile), handler: "run" },
          `journey-research:${ask.journey}:${ask.stage}`,
          { lookupId: queued.lookupId },
        );
      } catch (err) {
        await abandonProfileResearch(d.main, queued.lookupId, "The run could not be started.");
        throw err;
      }
      return { state: "started", lookupId: queued.lookupId };
    },
  };
}
