/**
 * Client accounts: setups watched and run, the Accounts console, mail, social and connector
 * access with their callbacks, the social inbox, the mail reader and marketing bounces.
 */

import { CONTENT_CHANNELS } from "@wren/config";
import {
  connectorAccess,
  connectorAppsFrom,
  makeConnectorCallback,
  makeConnectorSync,
  makeConnectors,
} from "@wren/connectors";
import { makeAccountsConsole } from "@wren/core/accounts/console";
import { sitesHost } from "@wren/core/autobrowse/box";
import { DESK, journaledSites, restateSites } from "@wren/core/autobrowse/restate";
import { delegatedMailbox } from "@wren/core/mailbox";
import { meteredSites } from "@wren/core/metered";
import { dbSendJournal } from "@wren/core/send-journal";
import { makeSetupAgent } from "@wren/core/setup-agent";
import { makeSetupWatch } from "@wren/core/setup-watch";
import { findPlace, PLACE_FINDER } from "@wren/delivery/sms";
import { crmLanding } from "@wren/reactivation";
import { makeMailReply } from "@wren/starling-conversations/restate";
import { sweepGrants } from "@wren/starling-email/access/access";
import { makeMailAccess, makeMailCallback } from "@wren/starling-email/access/console";
import {
  makeSocialAccess,
  makeSocialCallback,
  ownSwitchesOf,
} from "@wren/starling-inbound/connect";
import { makeBounceScheduler, makeSocialInbox } from "@wren/starling-inbound/restate";
import { WREN_LIMITS } from "@wren/starling-outbound/limits";
import { makeMailReader } from "@wren/watch/clients";
import { SETUPS } from "../setups.js";
import type { AnyService, Deps } from "./deps.js";

/** The accounts domain's services, in the order they were served from `services.ts`. */
export function accountsServices(deps: Deps): AnyService[] {
  const {
    clientDb,
    clientMail,
    clientSocial,
    db,
    fireAll,
    gmail,
    keys,
    notify,
    settings,
    setupChecks,
    setupLane,
    setupParts,
    socialApi,
  } = deps;
  // Client connected apps (designs/2026-10-09-connectors.md): same shape, read-only.
  const clientConnectors = connectorAccess({
    main: db,
    apps: connectorAppsFrom(keys, process.env),
    keys,
    origin: settings.portalOrigin ?? null,
    fetch,
  });
  const services: AnyService[] = [];
  services.push(
    // Rechecks done setups on their repeat; off until started by hand.
    makeSetupWatch({
      main: db,
      setups: SETUPS,
      checks: setupChecks,
      parts: setupParts,
      notifierFor: setupLane,
      ...notify,
    }),
    // Done-for-you steps in the owner's autobrowse; only queued with WREN_SETUP_AGENT. A Place
    // ID is a fixed read off Google Maps on the Mac (Google bot-checks the box), not the agent.
    makeSetupAgent({
      main: db,
      setups: SETUPS,
      parts: setupParts,
      wake: sitesHost(settings.autobrowseInstanceId).wake,
      finders: {
        [PLACE_FINDER]: (ctx, { account }) =>
          findPlace(restateSites(ctx, { caller: "wren:setup", service: DESK }), account.ref),
      },
    }),
    // A client's accounts and vendors; own keys bind by ref from the key store.
    makeAccountsConsole({
      db,
      setups: SETUPS,
      agent: settings.setupAgent,
      checks: new Set(Object.keys(setupChecks)),
      keys,
      parts: setupParts,
      limits: WREN_LIMITS,
    }),
    // Account → Mail, the OAuth callbacks, and the reader over every client's connected mailboxes.
    makeMailAccess({ main: db, access: clientMail, clientDb, setups: SETUPS }),
    makeMailCallback({ main: db, access: clientMail, clientDb, setups: SETUPS }),
    // A reply from the Inbox to mail in a client's mailbox, through that mailbox.
    makeMailReply({
      main: db,
      clientDb,
      sender: (client, address) => clientMail.senderOf(client, address),
    }),
    // Account → Social, its callback, and a client's DMs and comment answers on its own accounts.
    makeSocialAccess({
      main: db,
      access: clientSocial,
      // A connected TikTok's numbers on the page, read on the client's own token.
      sites: socialApi,
      // Wren's own channels on its Account → Social: config as `contentFor` reads it.
      own: {
        switches: ownSwitchesOf(settings),
        known: CONTENT_CHANNELS,
        box: sitesHost(settings.autobrowseInstanceId),
      },
    }),
    makeSocialCallback({ main: db, access: clientSocial }),
    // Account → Connectors, its callback, and each connected app's hourly read into the CRM.
    makeConnectors({ main: db, access: clientConnectors }),
    makeConnectorCallback({ main: db, access: clientConnectors }),
    makeConnectorSync({
      main: db,
      clientDb,
      crm: crmLanding,
      access: clientConnectors,
      fetch,
      fire: fireAll,
    }),
    makeSocialInbox({
      main: db,
      clientDb,
      access: clientSocial,
      sites: (ctx, client, part) =>
        meteredSites(journaledSites(ctx, socialApi, dbSendJournal(clientDb(client))), {
          main: db,
          client,
          part,
          now: () => new Date(),
          step: <T>(name: string, fn: () => Promise<T>) => ctx.run(name, fn),
          store: keys,
        }),
    }),
    makeMailReader({
      db,
      clientDb,
      clients: () => clientMail.readingClients(),
      boxesOf: (client) => clientMail.boxesOf(client),
      sweep: (at) => sweepGrants(db, at),
    }),
    // Marketing email bounces, hourly: portal@'s mailbox into main, each client's sender into its
    // own database; off until `BounceScheduler/all/start`.
    makeBounceScheduler({
      db,
      wren: settings.portalMailbox ? delegatedMailbox(gmail, settings.portalMailbox) : null,
      clientDb,
      clients: () => clientMail.readingClients(),
      boxesOf: (client) => clientMail.boxesOf(client),
    }),
  );
  return services;
}
