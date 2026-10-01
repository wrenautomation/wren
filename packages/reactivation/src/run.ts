/**
 * `crm run`: every stage that is due, in order, so nobody has to remember the
 * order. Each stage resumes on its own (a re-run picks up what is left), so the
 * whole run does too: Ctrl-C, then run again. A stage that aborts stops the
 * run; the stages after it would work on half a list. `crmStatus` says where
 * things stand afterwards.
 */
import type { EmailVerifier, LocalCheckerLike } from "@wren/channel-email";
import { type Feed, NO_FEED } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import type { Fetcher } from "@wren/research/fetch";
import { type CrmBriefStats, writeCrmBriefs } from "./brief.js";
import { type CrmComposeStats, composeCrmEmails } from "./compose.js";
import { type CrmVerifyStats, checkCrmEmails } from "./crm/verify.js";
import { STAGE_STARTS, stageDone } from "./feed.js";
import { type CrmLookupStats, lookUpCrmPeople } from "./lookup.js";
import type { ClientProfile } from "./schema.js";
import { type CrmScoreStats, scoreCrmContacts } from "./score.js";
import type { ReactivationSettings } from "./settings.js";
import { type CrmSignalsStats, checkCrmCompanies } from "./signals.js";
import { CRM_STAGES, type CrmStage, crmStatus } from "./status.js";

export interface CrmRunDeps {
  verifier: EmailVerifier;
  checker: LocalCheckerLike;
  /** The `sites` service for LinkedIn; null = lookup and signals stop and say why. */
  sites: SiteClient | null;
  /** For company sites and job boards; null = LinkedIn only. */
  fetcher: Fetcher | null;
  /** Writes briefs and emails; null = those stages stop and say why. */
  llm: LlmClient | null;
}

export interface CrmRunOptions {
  /** The client's LinkedIn account for logged-in reads; null = search only. */
  linkedin: string | null;
  /** At most this many units per stage. */
  limit?: number;
  runId?: string | null;
  /** The client's settings and profile; without them compose never runs. */
  compose?: {
    settings: ReactivationSettings;
    profile: ClientProfile | null;
    /** The demo never sends, so the send gate doesn't hold its drafts. */
    demo?: boolean;
  };
  /** Only these stages (the loop leaves the personal-account ones to `crm run`). */
  only?: readonly CrmStage[];
  /** Where the run says what it is doing; nobody watching when left out. */
  feed?: Feed;
}

export type CrmStageResult =
  | { stage: "verify"; stats: CrmVerifyStats }
  | { stage: "lookup"; stats: CrmLookupStats }
  | { stage: "signals"; stats: CrmSignalsStats }
  | { stage: "score"; stats: CrmScoreStats }
  | { stage: "brief"; stats: CrmBriefStats }
  | { stage: "compose"; stats: CrmComposeStats };

export async function runCrm(
  db: Queryable,
  deps: CrmRunDeps,
  opts: CrmRunOptions,
  onStage: (r: CrmStageResult) => void = () => {},
): Promise<CrmStageResult[]> {
  const stages: CrmStageResult[] = [];
  const feed = opts.feed ?? NO_FEED;
  const limit = opts.limit ? { limit: opts.limit } : {};
  const watched = { feed };
  const status = opts.compose ? { compose: opts.compose } : {};
  for (const stage of CRM_STAGES) {
    if (opts.only && !opts.only.includes(stage)) continue;
    // Asked fresh each time: an earlier stage can change what a later one has to do.
    if (!(await crmStatus(db, status)).due.includes(stage)) continue;
    await feed.emit({ step: stage, kind: "started", line: STAGE_STARTS[stage] });
    const r = await runStage(stage);
    await feed.emit(stageDone(r));
    stages.push(r);
    onStage(r);
    if (r.stats.aborted) break;
  }
  return stages;

  async function runStage(stage: CrmStage): Promise<CrmStageResult> {
    switch (stage) {
      case "verify":
        return {
          stage,
          stats: await checkCrmEmails(db, deps.verifier, deps.checker, {
            concurrency: 8,
            ...limit,
          }),
        };
      case "lookup":
        if (!deps.sites) return { stage, stats: { ...NO_LOOKUPS, aborted: NO_SITES } };
        return {
          stage,
          stats: await lookUpCrmPeople(db, deps.sites, {
            linkedin: opts.linkedin,
            runId: opts.runId ?? null,
            ...watched,
            ...limit,
          }),
        };
      case "signals":
        if (!deps.sites) return { stage, stats: { ...NO_SIGNALS, aborted: NO_SITES } };
        return {
          stage,
          stats: await checkCrmCompanies(
            db,
            { fetcher: deps.fetcher, sites: deps.sites },
            { linkedin: opts.linkedin, runId: opts.runId ?? null, ...watched, ...limit },
          ),
        };
      case "score":
        return { stage, stats: await scoreCrmContacts(db) };
      case "brief":
        return {
          stage,
          stats: deps.llm
            ? await writeCrmBriefs(db, deps.llm, {
                runId: opts.runId ?? null,
                ...watched,
                ...limit,
              })
            : { ...NO_BRIEFS, aborted: "briefs need an LLM: set WREN_LLM (it is fake)" },
        };
      case "compose":
        return {
          stage,
          stats:
            deps.llm && opts.compose
              ? await composeCrmEmails(db, deps.llm, {
                  ...opts.compose,
                  runId: opts.runId ?? null,
                  ...watched,
                  ...limit,
                })
              : { ...NO_EMAILS, aborted: "emails need an LLM and the client's settings" },
        };
    }
  }
}

const NO_BRIEFS: CrmBriefStats = {
  selected: 0,
  written: 0,
  empty: 0,
  failed: 0,
  dropped: 0,
  errors: 0,
  aborted: null,
};

const NO_EMAILS: CrmComposeStats = {
  selected: 0,
  drafted: 0,
  approved: 0,
  failed: 0,
  suppressed: 0,
  raced: 0,
  errors: 0,
  aborted: null,
};

const NO_SITES = "lookup and signals need the sites service: run them with `crm run`";

const NO_LOOKUPS: CrmLookupStats = {
  selected: 0,
  matched: 0,
  unresolved: 0,
  capped: 0,
  errors: 0,
  findings: {},
  aborted: null,
};

const NO_SIGNALS: CrmSignalsStats = {
  selected: 0,
  hiring: 0,
  no_openings: 0,
  unresolved: 0,
  capped: 0,
  errors: 0,
  aborted: null,
};
