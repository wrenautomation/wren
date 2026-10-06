/**
 * Job postings (S1): the pool's adapter over the built `checkHiring`. The firm's careers page and
 * its board's public API first; LinkedIn jobs only as `linkedin@alt`, and only when the board
 * step found nothing. The key is the built one, so `crm run` and the pool write the same finding.
 */
import type { SiteClient } from "@wren/core/content";
import { z } from "zod";
import { checkHiring } from "../companies/hiring.js";
import { linkedinCompany } from "../companies/profile.js";
import { signalDate } from "../findings.js";
import type { SignalCheckState } from "../schema.js";
import { defineCollector, firmOf, readAccount, subjectOf } from "./index.js";

/** Never called: with no `sites`, the LinkedIn step is off, so `checkHiring` never asks. */
const NO_SITES: SiteClient = {
  call: () => Promise.reject(new Error("no sites client")),
  via: async () => "none",
};

const STATE: Record<string, SignalCheckState> = {
  hiring: "found",
  no_openings: "none",
  unresolved: "unresolved",
  capped: "capped",
};

export const hiring = defineCollector({
  name: "hiring",
  subject: "company",
  built: true,
  settings: z.object({
    /** Read LinkedIn jobs (as linkedin@alt) when the firm's site names no board. */
    linkedin: z.boolean().default(true),
  }),
  bucket: { perDay: 150, burst: 20 },
  everyDays: 7,
  metered: false,
  async collect(deps, subject, s) {
    const key = subjectOf(subject);
    const firm = key && "companyId" in key ? await firmOf(deps.db, key.companyId) : null;
    if (!firm)
      return {
        state: "unresolved",
        signals: [],
        tried: [{ step: "firm", what: subject, outcome: "no such firm" }],
      };
    const account = s.linkedin && deps.sites ? readAccount(deps.linkedin) : null;
    const r = await checkHiring(
      { fetcher: deps.fetcher, sites: deps.sites ?? NO_SITES },
      {
        companyId: firm.id,
        firm: { name: firm.name, domain: firm.domain },
        linkedinPage: linkedinCompany(firm.linkedinUrl),
      },
      { linkedin: account, now: () => deps.now },
    );
    const tried = r.tried.map((t) => ({ ...t }));
    const f = r.finding;
    const at = f && signalDate(f, deps.now);
    const signals =
      f && at
        ? [
            {
              ...f,
              value: { ...f.value, title: hiringTitle(f.value), topic: "hiring" },
              signalAt: at.at,
              dated: at.dated,
            },
          ]
        : [];
    const state = STATE[r.state] ?? "unresolved";
    return {
      state,
      signals,
      tried,
      // A LinkedIn cap parks this firm only: the cap answers free, and later firms' boards still count.
      retryAt: r.retryAt,
    };
  },
});

/** One line: how many roles, and the newest one's title. */
function hiringTitle(v: Record<string, unknown>): string {
  const n = Number(v.count ?? 0);
  const newest = (v.roles as { title?: string }[] | undefined)?.[0]?.title;
  const roles = `${n} open role${n === 1 ? "" : "s"}`;
  return newest ? `${roles}, newest: ${newest}` : roles;
}
