/**
 * Every service the worker serves, built from settings. Shared by the hosts: the box (`box.ts`),
 * local dev (`main.ts`) and the Lambda (`lambda.ts`). Nothing here assumes a process lifetime
 * beyond one invocation: state lives in Postgres. Each domain's file under `services/` wires its
 * own services from the shared deps; this is the list. Lambda loads a domain's code on its first
 * turn (`lazy`); every other host loads all (designs/2026-11-09-own-runtime.md, "Group 5").
 */
import type { Settings } from "@wren/config";
import type { Logger } from "pino";
import { type AnyService, type BuildOptions, buildDeps, type Deps } from "./services/deps.js";

export type { AnyService, BuildOptions, Deps } from "./services/deps.js";

export interface Services {
  /** Every service built so far: all of them, unless `lazy`. */
  services: AnyService[];
  /** Service name → its domain (`DOMAINS` key), for each service built. */
  domainOf: ReadonlyMap<string, string>;
  /** Lazy: build the service's domain (`domain` when the box named it), or every domain. */
  need(service?: string, domain?: string): Promise<void>;
  /** What was wired, for the startup log line. Never a secret. */
  summary: Record<string, string | number | boolean>;
  close(): Promise<void>;
}

/**
 * The pool chain: research and mailbox checks, waiting on sites and mail servers far longer
 * than it computes. Lambda bills every second of that wait, so the box runs it (`box.ts`).
 */
const POOL_CHAIN = ["LeadPoolFill", "CompanySiteFind", "CompanyEnrich", "LeadVerify"];
/**
 * The box lane (`rt.ts`): the chain; the page archive, which moves rows out of its own disk;
 * the books' day and the triage, which wait on the model and the Mac's desk; Canon's index, which
 * keeps a git clone on the box's disk.
 */
export const BOX_SERVICES = [
  ...POOL_CHAIN,
  "CanonIndexSync",
  "PageHtmlArchive",
  "BooksClose",
  "MyMailTriage",
  "SocialActivityRead",
];

type Domain = (deps: Deps) => AnyService[];

/**
 * Every domain's services, in the order they are served; a new domain is one file and one row.
 * Dynamic imports: the Lambda bundle splits per domain, so a cold start loads one.
 */
const DOMAINS: Record<string, () => Promise<Domain>> = {
  research: async () => (await import("./services/research.js")).researchServices,
  email: async () => (await import("./services/email.js")).emailServices,
  content: async () => (await import("./services/content.js")).contentServices,
  calendar: async () => (await import("./services/calendar.js")).calendarServices,
  apps: async () => (await import("./services/apps.js")).appsServices,
  platform: async () => (await import("./services/platform.js")).platformServices,
  books: async () => (await import("./services/books.js")).booksServices,
  watch: async () => (await import("./services/watch.js")).watchServices,
  variants: async () => (await import("./services/variants.js")).variantsServices,
  aerie: async () => (await import("./services/aerie.js")).aerieServices,
  sms: async () => (await import("./services/sms.js")).smsServices,
  people: async () => (await import("./services/people.js")).peopleServices,
  reach: async () => (await import("./services/reach.js")).reachServices,
  search: async () => (await import("./services/search.js")).searchServices,
  clients: async () => (await import("./services/clients.js")).clientsServices,
  executor: async () => (await import("./services/executor.js")).executorServices,
  accounts: async () => (await import("./services/accounts.js")).accountsServices,
  reactivation: async () => (await import("./services/reactivation.js")).reactivationServices,
};

export async function buildServices(
  settings: Settings,
  log: Logger,
  opts: BuildOptions & { lazy?: boolean },
): Promise<Services> {
  const services: AnyService[] = [];
  const domainOf = new Map<string, string>();
  const loading = new Map<string, Promise<void>>();
  let whole = false;
  const load = (name: string) => {
    let p = loading.get(name);
    if (!p) {
      const t0 = performance.now();
      p = (DOMAINS[name] as () => Promise<Domain>)().then((build) => {
        for (const s of build(deps)) {
          services.push(s);
          domainOf.set(s.name, name);
        }
        if (opts.lazy) log.info({ domain: name, ms: Math.round(performance.now() - t0) }, "domain");
      });
      loading.set(name, p);
    }
    return p;
  };
  // in order, so the box serves services in DOMAINS order
  const loadAll = async () => {
    for (const name of Object.keys(DOMAINS)) await load(name);
    whole = true;
  };
  const deps = await buildDeps(
    settings,
    log,
    opts,
    // lazy, before every domain loaded: a name not built yet may still be (as viewAsApi's default)
    (service) => !whole || services.some((x) => x.name === service),
    async () => {
      await loadAll();
      return services;
    },
  );
  if (!opts.lazy) await loadAll();
  const need = async (service?: string, domain?: string) => {
    if (whole) return;
    if (domain && domain in DOMAINS) await load(domain);
    // an old box names no domain; a moved service is not in the one named
    if (!service || !domainOf.has(service)) await loadAll();
  };
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
    domainOf,
    need,
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
