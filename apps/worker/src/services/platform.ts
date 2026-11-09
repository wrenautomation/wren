/**
 * The platform's own loops: token renewal, the vault's keys, audit seals, Decide, webhooks,
 * dead letters and the loop watch, and the console portal every page calls.
 */
import { BOOKS_CONSOLE_VIEWS } from "@wren/books";
import { landerVisitLines } from "@wren/calendar/calls";
import { ingressOf } from "@wren/config";
import { makeAuditLogSeal } from "@wren/core/audit";
import { sitesHost } from "@wren/core/autobrowse/box";
import { makeSiteTokenRenew } from "@wren/core/autobrowse/renewal";
import { cacheFrom } from "@wren/core/cache";
import { makeConsolePortal, restateAdminGet, runtimeAdmin } from "@wren/core/console";
import { makeFailedCallAlert } from "@wren/core/dead-letters";
import { backendsFromEnv, deskJudge, leadFitSource, makeJudge } from "@wren/core/decide";
import { makeLoopRevive } from "@wren/core/loop-watch";
import { makeVaultKeyMirror } from "@wren/core/vault-keys";
import { makeWebhooks, turnedOffTeller } from "@wren/core/webhooks";
import { engagementOf, postUpdate } from "@wren/delivery";
import { s3Files } from "@wren/delivery/files";
import { makeLlm } from "@wren/llm";
import { leadOffers } from "@wren/offers";
import { EMAIL_CONSOLE_VIEWS, EMAIL_COST_VIEWS } from "@wren/starling-email/views";
import { policyFrom as reachPolicyFrom } from "@wren/starling-outbound";
import { commentSource } from "@wren/starling-outbound/decide";
import { COMPONENTS } from "../components.js";
import { consoleRecords } from "../console-records.js";
import { SETUPS } from "../setups.js";
import { WORKFLOWS } from "../workflows.js";
import type { AnyService, Deps } from "./deps.js";

/** The platform domain's services, in the order they were served from `services.ts`. */
export function platformServices(deps: Deps): AnyService[] {
  const {
    bookerMailer,
    bound,
    databaseUrl,
    db,
    edge,
    laneNotifier,
    mediaSigner,
    notify,
    openClient,
    policy,
    roster,
    settings,
  } = deps;
  // Redis on the box when WREN_CACHE_URL is set: one Lambda's read serves the rest.
  const cache = cacheFrom(settings.cacheUrl);
  // both runtimes' invocations: Restate's and the pg runtime's (designs/2026-11-09-own-runtime.md)
  const admin = runtimeAdmin(db, settings.restateAdminUrl, settings.restateAuthToken);
  // The lander's recorded views: the export lists them, the files bucket signs their chunks.
  const sessions =
    settings.siteExportToken && settings.filesBucket
      ? {
          site: { baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken },
          signGet: s3Files({ bucket: settings.filesBucket }).getUrl,
        }
      : undefined;
  const services: AnyService[] = [];
  // autobrowse's tokens made again before they lapse (LinkedIn's 60 days, npm's 90).
  services.push(
    makeSiteTokenRenew({ db, host: sitesHost(settings.autobrowseInstanceId), ...notify }),
  );
  // The operator's API keys, mirrored from autobrowse's vault each hour; the Accounts page's actions.
  services.push(
    makeVaultKeyMirror({ db, host: sitesHost(settings.autobrowseInstanceId), ...notify }),
  );
  // The audit log's seals in every database, every 15 minutes; off until `wren audit sealer start`.
  services.push(makeAuditLogSeal({ main: db, open: openClient, ...notify }));
  services.push(
    // Judge (designs/2026-11-04-loops.md): drafted comments and lead fits judged every 10 minutes by
    // Claude Code on the desk, each answer logged beside his call; other kinds on WREN_DECIDE's chain.
    makeJudge({
      main: db,
      // Lead checks last: a drafted comment comes first in a short pass.
      sources: [commentSource, leadFitSource(leadOffers())],
      backends: () =>
        backendsFromEnv(process.env, (spec) => makeLlm(spec, process.env), {
          agent: deskJudge(ingressOf(settings)),
        }),
    }),
    makeWebhooks({
      main: db,
      // A URL Wren turned off: its client's owners and whoever added it hear from portal@.
      ...(bookerMailer
        ? { tell: turnedOffTeller(db, bookerMailer("Wren"), settings.portalOrigin ?? undefined) }
        : {}),
    }),
    // Files every invocation paused after its retries as a dead letter; Discord hears once.
    makeFailedCallAlert({ main: db, admin: admin.query, patch: admin.patch, ...notify }),
    // Wakes a loop whose chain ended; names one stuck behind a call (designs/2026-10-16-loop-watchdog.md).
    makeLoopRevive({ main: db, admin: admin.query, ...notify }),
    makeConsolePortal({
      main: db,
      mainUrl: databaseUrl,
      setups: SETUPS,
      edge,
      views: EMAIL_CONSOLE_VIEWS,
      moneyViews: [...EMAIL_COST_VIEWS, ...BOOKS_CONSOLE_VIEWS],
      records: consoleRecords({
        email: { roster, policy },
        smsSenderName: settings.smsSenderName,
        media: mediaSigner,
        reach: reachPolicyFrom(settings),
        // Calls recorded on the Mac: the mp4 signed from the files bucket when opened.
        recordings: settings.filesBucket
          ? s3Files({ bucket: settings.filesBucket }).getUrl
          : undefined,
        sessions,
        ...(settings.siteExportToken
          ? {
              visits: landerVisitLines({
                baseUrl: settings.siteBaseUrl,
                exportToken: settings.siteExportToken,
              }),
            }
          : {}),
      }),
      components: COMPONENTS,
      workflows: WORKFLOWS,
      // A component's client loops start and stop with it, when this worker binds them.
      bound,
      // "Ask for this": a line on the client's running project, where Wren answers, and a ping.
      asked: async (client, by, c) => {
        const e = await engagementOf(db, client.id).catch(() => null);
        if (e) await postUpdate(db, e, { body: `Asked for ${c.name}.`, author: by });
        await laneNotifier(settings.discordClientsWebhookUrl).notify(
          `Clients: ${client.id} asks for ${c.name}`,
          `${by} asked in the Marketplace.${e ? " It's on their project's updates: answer there." : ""}`,
          "action",
        );
      },
      admin: admin.query,
      adminGet: settings.restateAdminUrl
        ? restateAdminGet(settings.restateAdminUrl, settings.restateAuthToken, cache)
        : undefined,
    }),
  );
  return services;
}
