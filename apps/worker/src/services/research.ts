/**
 * The research chain: enrichment, profile research, discovery and resolution over the pool,
 * the pool-feeder that walks them per niche, and the page archive that moves old page HTML
 * off the box.
 */
import { campaignPolicy, recheckLeads } from "@wren/channel-email";
import {
  dailyOpenerCapacity,
  makePoolScheduler,
  makeResolution,
} from "@wren/channel-email/restate";
import { ingressOf } from "@wren/config";
import { sitesHost } from "@wren/core/content/box";
import { ingressSites } from "@wren/core/content/ingress";
import { DESK } from "@wren/core/content/restate";
import { meteredModel } from "@wren/core/metered";
import { clientDatabaseName, clientDatabaseUrl, createDb } from "@wren/db";
import { llmForKey } from "@wren/llm";
import {
  adLibraryFor,
  crawlHintsFor,
  discoveryWordsFor,
  exaSearchFor,
  fbGroupsFor,
  triggersFor,
  youtubeSearchFor,
} from "@wren/niches";
import { YOUTUBE_READ_SCOPE, youtubeApi } from "@wren/research/enrichment";
import { s3PageStore } from "@wren/research/pages";
import {
  makeDiscovery,
  makeEnrichment,
  makePageArchive,
  makeProfileResearch,
} from "@wren/research/restate";
import { serviceAccountToken } from "@wrenautomation/autobrowse/google";
import { PoliteFetcher } from "@wrenautomation/weaver/fetch";
import {
  type AnyService,
  BOOKS_DESK_TIMEOUT_MS,
  type Deps,
  googleKey,
  WORKER_APP,
} from "./deps.js";

/** The research domain's services, in the order they were served from `services.ts`. */
export function researchServices(deps: Deps): AnyService[] {
  const {
    campaigns,
    clientDb,
    databaseUrl,
    db,
    fleet,
    freeVerdicts,
    keyPath,
    keys,
    llm,
    notify,
    policy,
    renderer,
    settings,
    tracer,
    ua,
    verifier,
  } = deps;
  const pages = settings.pagesBucket ? s3PageStore(settings.pagesBucket) : null;
  // Read-only YouTube as the service account, minted on first read: a worker without the
  // key still starts, and the stage then stops on its errors.
  let youtubeToken: (() => Promise<string>) | null = null;
  const youtube = youtubeApi(() => {
    youtubeToken ??= serviceAccountToken(googleKey(keyPath), {
      scopes: [YOUTUBE_READ_SCOPE],
    });
    return youtubeToken();
  });
  // `profiles` and "Research this person" run inside a unit's ctx.run, so through the ingress.
  const profileSites = ingressSites(ingressOf(settings), {
    caller: "wren:profiles",
    ...sitesHost(settings.autobrowseInstanceId),
    timeoutMs: BOOKS_DESK_TIMEOUT_MS,
  });
  const services: AnyService[] = [
    // A dead firm site at 30s × 3 tries held one shard ~90s a page; a live one answers in seconds.
    makeEnrichment({
      db,
      clientDb,
      fetcher: ua ? new PoliteFetcher(ua, { timeout: 10, retries: 2 }) : null,
      llm,
      // A client niche's model stages on its own key or Wren's, metered on its share.
      clientLlm: (client, part, runId) =>
        meteredModel(llm, {
          main: db,
          client,
          part,
          now: () => new Date(),
          store: keys,
          own: llmForKey,
          unset: "managed",
          runId,
        }),
      renderer,
      tracer,
      crawlHintsFor,
      pages,
      // The render pass sends blocked companies up the fetch ladder (`web GET /fetch`); inside a unit's ctx.run, so the ingress. A render can take ~60 s.
      ladder: ingressSites(ingressOf(settings), {
        caller: "wren:render",
        ...sitesHost(settings.autobrowseInstanceId),
        timeoutMs: 120_000,
      }),
      // `profiles` runs inside the unit's ctx.run, so through the ingress; a Mac that is off fails fast.
      sites: profileSites,
      linkedin: settings.poolLinkedin ?? null,
      recheck: recheckLeads,
      youtube,
      keys,
      // autobrowse's `meta` site (Graph business_discovery); inside a unit's ctx.run, so the ingress.
      instagram: ingressSites(ingressOf(settings), {
        caller: "wren:instagram",
        ...sitesHost(settings.autobrowseInstanceId),
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      // Meta's Ad Library and public groups signed out (`fb-public`), on the Mac's home IP; a Mac that is off fails the stage fast.
      desk: ingressSites(ingressOf(settings), {
        caller: "wren:ad-library",
        service: DESK,
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      adsFor: adLibraryFor,
      groupsFor: fbGroupsFor,
      // Exa's company index through `web` (an api route, so the sites service, not the desk).
      exaSites: ingressSites(ingressOf(settings), {
        caller: "wren:exa-search",
        ...sitesHost(settings.autobrowseInstanceId),
        timeoutMs: BOOKS_DESK_TIMEOUT_MS,
      }),
      exaFor: exaSearchFor,
      youtubeSearchFor,
      triggersFor,
    }),
    // One "Research this person" run: Exa, Google and the account, on the same day budgets as `profiles`.
    makeProfileResearch({
      db,
      sites: profileSites,
      linkedin: settings.poolLinkedin ?? null,
      timezone: settings.sendTimezone,
    }),
    // Discovery probes guessed hosts, most of them parked or dead: a short timeout and
    // one try per URL, or a single company's guesses can eat a Lambda invocation.
    makeDiscovery({
      db,
      clientDb,
      fetcher: ua ? new PoliteFetcher(ua, { timeout: 8, retries: 1 }) : null,
      genericWordsFor: discoveryWordsFor,
    }),
    makeResolution({
      db,
      clientDb,
      verifier,
      openPool: (max, client) =>
        createDb(
          client ? clientDatabaseUrl(databaseUrl, clientDatabaseName(client)) : databaseUrl,
          { max, app: WORKER_APP },
        ),
    }),
  ];
  // The pool-feeder walks the research chain per niche; what may spend is a setting.
  // A week of the niche's sends ahead of compose: the queue `profiles` and `signals` read.
  const queueAhead = {
    ahead: async (niche: string, now: Date) =>
      7 *
      dailyOpenerCapacity(
        await campaignPolicy(db, policy),
        niche,
        campaigns.get(niche)?.senders ?? [],
        now,
        fleet.ramps,
      ),
    horizonDays: settings.verificationHorizonDays,
  };
  services.push(
    makePoolScheduler({
      db,
      clientDb,
      policy,
      modelStages: settings.poolModelStages,
      freeVerifier: freeVerdicts,
      youtube: true,
      instagram: true,
      adLibrary: true,
      fbGroups: true,
      exaSearch: true,
      youtubeSearch: true,
      // Needs the fetcher (RSS) and a model; Enrichment refuses without the fetcher.
      triggers: ua !== null,
      recheck: {
        horizonDays: settings.verificationHorizonDays,
        policy: (niche) => campaigns.get(niche)?.recontact,
      },
      // Metered: off unless WREN_POOL_PROFILES.
      ...(settings.poolProfiles ? { profiles: queueAhead } : {}),
      // Free; idle until a collector is built, then each one's `on` setting.
      signals: queueAhead,
    }),
  );
  // Page HTML a day old moves to the pages bucket; off until `wren pages archive start`.
  services.push(makePageArchive({ db, pages, ...notify }));
  return services;
}
