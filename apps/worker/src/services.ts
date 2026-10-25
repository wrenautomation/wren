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
import { watchServices } from "./services/watch.js";

export type { AnyService, BuildOptions, Deps } from "./services/deps.js";

export interface Services {
  services: AnyService[];
  /** What was wired, for the startup log line. Never a secret. */
  summary: Record<string, string | number | boolean>;
  close(): Promise<void>;
}

/**
 * The pool chain: research and mailbox checks, waiting on sites and mail servers far
 * longer than it computes. Lambda bills every second of that wait, so with
 * `WREN_POOL_CHAIN_HOST=box` the Postgres box serves it (`box.ts`), next to the data.
 * Restate keeps each service on one deployment: whichever side serves it, the other skips it.
 */
export const POOL_CHAIN = ["PoolScheduler", "Discovery", "Enrichment", "Resolution"];
/**
 * Everything the box serves: the chain; the page archive, which moves rows out of
 * its own disk; and the books' day, which waits on the model and the Mac's desk.
 */
export const BOX_SERVICES = [...POOL_CHAIN, "PageArchive", "Books", "Watch", "SocialWatch"];

export function servicesFor(
  all: AnyService[],
  here: "box" | "lambda",
  chainHost = process.env.WREN_POOL_CHAIN_HOST,
): AnyService[] {
  const inChain = (s: AnyService) => BOX_SERVICES.includes(s.name);
  if (here === "box") return all.filter(inChain);
  return chainHost === "box" ? all.filter((s) => !inChain(s)) : all;
}

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
  const deps = await buildDeps(settings, log, opts, (service) =>
    services.some((x) => x.name === service),
  );
  for (const domain of DOMAINS) services.push(...domain(deps));
  const {
    classify,
    fleet,
    handle,
    llm,
    notifier,
    opens,
    postmaster,
    renderer,
    report,
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
      opens: opens !== null,
      placement_seeds: settings.placementSeeds.length,
      report: report !== null,
      content: settings.contentChannels.join(",") || "none",
      ads: settings.metaAdAccountId ?? "first account",
      content_voice: voice !== null ? "file" : "default",
      sms: smsProvider.name,
      sms_live: settings.smsLive,
      reach_live: settings.reachLive,
      sms_alerts: Boolean(settings.smsPushPublicKey),
    },
    close: () => handle.close(),
  };
}
