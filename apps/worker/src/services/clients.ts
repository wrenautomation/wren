/**
 * Clients: health and flags, delivery and billing with their portals, domains, Ask, tokens and
 * call briefs.
 */
import { plainMailer } from "@wren/channel-email";
import { makeCallBriefs } from "@wren/channel-email/calls";
import { makeAsk } from "@wren/core/ask";
import { CustomHostnames } from "@wren/core/clients";
import { namedFor } from "@wren/core/notify";
import { failedRuns } from "@wren/core/spine";
import { makeTokens } from "@wren/core/tokens";
import { makeBillingWatch, parseReceive, wiseReader } from "@wren/delivery/billing";
import { makeBillingConsole } from "@wren/delivery/billing/console";
import { s3Files } from "@wren/delivery/files";
import { makeHealthConsole } from "@wren/delivery/health/console";
import { makeDeliveryPortal, makeDeliveryWatch, makeDomainsResolver } from "@wren/delivery/restate";
import { DEMO_NAME } from "@wren/reactivation/restate";
import { WORKFLOWS } from "../workflows.js";
import type { AnyService, Deps } from "./deps.js";

/**
 * Client portals on their own hosts (designs/2026-10-06-custom-domains.md): Cloudflare for SaaS
 * on our zone, with a token that only edits custom hostnames. Unset: adding one says not yet.
 */
function customDomains() {
  const token = process.env.WREN_CLOUDFLARE_SAAS_TOKEN;
  const zone = process.env.WREN_CLOUDFLARE_ZONE_ID;
  const target = process.env.WREN_CUSTOM_DOMAIN_TARGET;
  return {
    ...(target ? { target } : {}),
    ...(token && zone ? { cloudflare: new CustomHostnames({ token, zone }) } : {}),
  };
}

/** The clients domain's services, in the order they were served from `services.ts`. */
export function clientsServices(deps: Deps): AnyService[] {
  const {
    callBriefs,
    clientDb,
    clientMail,
    clientsNotify,
    db,
    fireAll,
    gmail,
    laneNotifier,
    log,
    notifier,
    openClient,
    settings,
  } = deps;
  const services: AnyService[] = [];
  // Health and flags: Wren's rating, an override, a flag taken, addressed or cleared.
  services.push(makeHealthConsole(db));
  const portal = settings.portalOrigin ?? null;
  // The client portal (apps/portal): delivery for every client, each product's
  // own pages, and one reactivation loop per client.
  // DeliveryWatch mails clients from portal@ and pings us when one could feel forgotten.
  if (portal)
    services.push(
      makeDeliveryWatch({
        main: db,
        send:
          settings.portalFrom && settings.portalMailbox
            ? plainMailer(gmail, {
                mailbox: settings.portalMailbox,
                from: settings.portalFrom,
                name: "Wren",
              })
            : null,
        app: portal,
        zone: settings.sendTimezone,
        fire: fireAll,
        // The error digest: each database's failed runs, a flag per client and workflow.
        failures: {
          of: (client) => failedRuns(client ? clientDb(client) : db),
          name: (id) => WORKFLOWS.find((w) => w.id === id)?.name ?? id,
        },
        ...clientsNotify,
        // Wren's own workflows failing is ops news, not a client's (#ops, the main webhook).
        ...(settings.notify === "none" ? {} : { ops: notifier }),
      }),
    );
  else log.info("WREN_PORTAL_ORIGIN unset: no DeliveryWatch");
  // Wren's own billing by bank transfer (designs/2026-10-15-wise-billing.md): bills, mails and
  // reads money in from our Wise account. The token is read only; it never moves money.
  if (portal)
    services.push(
      makeBillingWatch({
        main: db,
        wise:
          settings.wiseApiToken && settings.wiseProfileId
            ? wiseReader({ token: settings.wiseApiToken, profileId: settings.wiseProfileId })
            : null,
        send:
          settings.portalFrom && settings.portalMailbox
            ? plainMailer(gmail, {
                mailbox: settings.portalMailbox,
                from: settings.portalFrom,
                name: "Wren",
              })
            : null,
        receive: parseReceive(settings.wiseReceiveDetails),
        ...(settings.taxNumber ? { taxNumber: settings.taxNumber } : {}),
        app: portal,
        zone: settings.sendTimezone,
        ...(settings.notify === "none" ? {} : { notifier }),
        fire: fireAll,
      }),
    );
  services.push(makeBillingConsole(db));
  services.push(
    makeDeliveryPortal({
      main: db,
      demoName: DEMO_NAME,
      files: settings.filesBucket ? s3Files({ bucket: settings.filesBucket }) : undefined,
      watched: portal !== null,
      zone: settings.sendTimezone,
      app: portal ?? undefined,
      receive: parseReceive(settings.wiseReceiveDetails),
      ...(settings.taxNumber ? { taxNumber: settings.taxNumber } : {}),
      domains: customDomains(),
      // The message rules on Account live in each client's own database.
      open: openClient,
      senders: (client) => clientMail.sendersOf(client),
      readers: async (client) => (await clientMail.boxesOf(client)).map((b) => b.address),
    }),
    makeDomainsResolver({ main: db }),
    makeAsk(db),
    makeTokens(db),
    makeCallBriefs({
      ...callBriefs,
      // The email lane: a count and a link, named for the client. None with WREN_NOTIFY=none.
      notifierFor: (client) => {
        if (settings.notify === "none") return null;
        const lane = laneNotifier(settings.discordEmailWebhookUrl);
        return client ? namedFor(lane, client) : lane;
      },
      portal,
    }),
  );
  return services;
}
