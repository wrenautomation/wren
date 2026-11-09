/**
 * Every Restate service the worker serves, built once from settings. Shared by
 * the two hosts: the Node listener (`main.ts`, local/compose) and the Lambda
 * handler (`lambda.ts`, Restate Cloud). Nothing here assumes a process lifetime
 * beyond one invocation: state lives in Restate and Postgres. Each domain's file under
 * `services/` wires its own services from the shared deps; this is the list.
 */
import type { Settings } from "@wren/config";
import type { Logger } from "pino";
import { accountsServices } from "./services/accounts.js";
import { appsServices } from "./services/apps.js";
import { booksServices } from "./services/books.js";
import { calendarServices } from "./services/calendar.js";
import { clientsServices } from "./services/clients.js";
import { contentServices } from "./services/content.js";
import { type AnyService, type BuildOptions, buildDeps, type Deps } from "./services/deps.js";
import { emailServices } from "./services/email.js";
import { executorServices } from "./services/executor.js";
import { peopleServices } from "./services/people.js";
import { platformServices } from "./services/platform.js";
import { reachServices } from "./services/reach.js";
import { reactivationServices } from "./services/reactivation.js";
import { researchServices } from "./services/research.js";
import { searchServices } from "./services/search.js";
import { smsServices } from "./services/sms.js";
import { variantsServices } from "./services/variants.js";
import { watchServices } from "./services/watch.js";

export type { AnyService, BuildOptions, Deps } from "./services/deps.js";

export interface Services {
  services: AnyService[];
  /** What was wired, for the startup log line. Never a secret. */
  summary: Record<string, string | number | boolean>;
  close(): Promise<void>;
}

/**
 * The pool chain: research and mailbox checks, waiting on sites and mail servers far longer
 * than it computes. Lambda bills every second of that wait, so the box runs it (`box.ts`).
 */
export const POOL_CHAIN = ["LeadPoolFill", "CompanySiteFind", "CompanyEnrich", "LeadVerify"];
/**
 * The box lane (`rt.ts`): the chain; the page archive, which moves rows out of its own disk;
 * the books' day and the triage, which wait on the model and the Mac's desk.
 */
export const BOX_SERVICES = [
  ...POOL_CHAIN,
  "PageHtmlArchive",
  "BooksClose",
  "MyMailTriage",
  "SocialActivityRead",
];

/** Every domain's services, in the order they are served; a new domain is one file and one row. */
const DOMAINS: ((deps: Deps) => AnyService[])[] = [
  researchServices,
  emailServices,
  contentServices,
  calendarServices,
  appsServices,
  platformServices,
  booksServices,
  watchServices,
  variantsServices,
  smsServices,
  peopleServices,
  reachServices,
  searchServices,
  clientsServices,
  executorServices,
  accountsServices,
  reactivationServices,
];

export async function buildServices(
  settings: Settings,
  log: Logger,
  opts: BuildOptions,
): Promise<Services> {
  const services: AnyService[] = [];
  const deps = await buildDeps(
    settings,
    log,
    opts,
    (service) => services.some((x) => x.name === service),
    () => services,
  );
  for (const domain of DOMAINS) services.push(...domain(deps));
  const {
    classify,
    fleet,
    handle,
    llm,
    notifier,
    postmaster,
    renderer,
    smsProvider,
    transport,
    verifier,
    voice,
  } = deps;

  return {
    services,
    summary: {
      llm: llm.name,
      classify,
      verifier: verifier.name,
      renderer: renderer ? settings.renderer : "none",
      transport: transport.name,
      senders: fleet.senders.length,
      compose_days_ahead: settings.composeDaysAhead,
      pool_model_stages: settings.poolModelStages,
      pool_profiles: settings.poolProfiles,
      notify: notifier.name,
      postmaster: postmaster !== null,
      placement_seeds: settings.placementSeeds.length,
      content: settings.contentChannels.join(",") || "none",
      content_voice: voice !== null ? "file" : "default",
      sms: smsProvider.name,
      sms_live: settings.smsLive,
      reach_live: settings.reachLive,
      sms_alerts: Boolean(settings.smsPushPublicKey),
    },
    close: () => handle.close(),
  };
}
