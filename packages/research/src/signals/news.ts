/**
 * Company news (S2): `searchEvents` over Google News RSS, then the Google page (50 a day of the
 * shared budget), then Exa. The pool reads every kind; `crm run` keeps its 4.
 */
import { z } from "zod";
import { eventFinding, NEWS_KINDS, searchEvents } from "../companies/events.js";
import { defineCollector, firmOf, subjectOf } from "./index.js";

export const news = defineCollector({
  name: "news",
  subject: "company",
  built: true,
  settings: z.object({
    kinds: z
      .array(z.enum(NEWS_KINDS))
      .min(1)
      .default([...NEWS_KINDS]),
  }),
  bucket: { perDay: 200, burst: 20 },
  everyDays: 30,
  metered: false,
  async collect(deps, subject, s) {
    const who = subjectOf(subject);
    const firm = who && "companyId" in who ? await firmOf(deps.db, who.companyId) : null;
    if (!firm)
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "firm", what: subject, outcome: "no such firm" }],
      };
    if (!deps.sites)
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "sites", what: subject, outcome: "no sites client" }],
      };
    const r = await searchEvents(deps.sites, firm, {
      google: deps.googleLeft > 0,
      kinds: s.kinds,
      fetcher: deps.fetcher,
      now: () => deps.now,
    });
    return {
      state: r.state,
      signals: r.events.map((e) => eventFinding(firm.id, e)),
      tried: r.tried.map((t) => ({ ...t })),
      retryAt: r.retryAt,
    };
  },
});
