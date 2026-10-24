/**
 * Cold email: the send and inbox schedulers, disposition, call bookings, marketing mail and
 * the newsletter, compose and the queue, placement, Postmaster, opens and clicks, the Friday
 * report, and the Email console.
 */
import {
  Broadcast,
  campaignPolicy,
  clientReplies,
  mailDomainTargets,
  proberHosts,
  senderDomain,
  senderFleet,
  sequencesSendScope,
  sharedFor,
} from "@wren/channel-email";
import { type Listmonk, listmonk } from "@wren/channel-email/listmonk";
import {
  DISPOSITION_KEY,
  inboxPush,
  makeCallBookings,
  makeClicksScheduler,
  makeComposeScheduler,
  makeDigestScheduler,
  makeDisposition,
  makeEmailConsole,
  makeInboxScheduler,
  makeListmonkIntake,
  makeListmonkMail,
  makeListmonkSync,
  makeMarketing,
  makeNewsletter,
  makeOpensScheduler,
  makePlacementScheduler,
  makePostmasterScheduler,
  makeQueueRefresh,
  makeReportScheduler,
  makeSendScheduler,
  type SendScope,
  syncTopicByName,
} from "@wren/channel-email/restate";
import type { Calendar } from "@wren/core/calendar";
import { sitesHost } from "@wren/core/content/box";
import { restateSites } from "@wren/core/content/restate";
import { meteredModel } from "@wren/core/metered";
import { clientKey, clientOfKey, LIMITS } from "@wren/core/restate";
import { llmForKey } from "@wren/llm";
import { clientSendScope } from "@wren/reactivation";
import { gmailPushTopic } from "@wrenautomation/autobrowse/google";
import { ImapReader, type InboxReader, RoutedReader } from "@wrenautomation/autobrowse/mail";
import { type AnyService, type Deps, googleKey } from "./deps.js";

/** The email domain's services, in the order they were served from `services.ts`. */
export function emailServices(deps: Deps): AnyService[] {
  const {
    calendar,
    campaigns,
    classify,
    clientBookings,
    clientDb,
    db,
    fireAll,
    fleet,
    freeVerdicts,
    gmail,
    instantlyInboxes,
    instantlyReader,
    keyPath,
    keys,
    lane,
    laneNotifier,
    llm,
    mailboxes,
    noPush,
    openClient,
    opens,
    operatorText,
    policy,
    portalMail,
    postmaster,
    report,
    roster,
    settings,
    smtpInboxes,
    tracer,
    transport,
  } = deps;
  const emailNotify = lane(settings.discordEmailWebhookUrl);
  // Warm replies wait on William, so their pings also text his phone (Discord stays the log).
  const replyNotifier = operatorText
    ? new Broadcast([laneNotifier(settings.discordEmailWebhookUrl), operatorText])
    : laneNotifier(settings.discordEmailWebhookUrl);
  // Each tick reads the console's campaign overrides, so a kill switch or opener stop needs no deploy.
  const wrenScope = async (): Promise<SendScope> => ({
    db,
    policy: await campaignPolicy(db, policy),
    fleet,
    calendar,
    // The pixel goes into mail only when asked; the host alone just enables the opens pull.
    pixelBaseUrl: settings.openTracking ? (settings.pixelBaseUrl ?? null) : null,
  });
  const clients = { main: db, open: openClient, policy };
  // The newsletter's lists, subscribers and campaigns live in Listmonk when its three settings are set.
  const lm: Listmonk | null =
    settings.listmonkUrl && settings.listmonkUser && settings.listmonkToken
      ? listmonk({
          url: settings.listmonkUrl,
          user: settings.listmonkUser,
          token: settings.listmonkToken,
        })
      : null;
  // The inbox side reads the real mailboxes whatever the send transport: replies,
  // bounces and unsubscribes to the Python fleet's sends are still ours to act on.
  const reader: InboxReader = new RoutedReader(
    gmail,
    new Map<string, InboxReader>([
      ...smtpInboxes.map(([address, m]) => [address, new ImapReader(m.imap)] as const),
      ...(instantlyReader
        ? instantlyInboxes.map((address) => [address, instantlyReader] as const)
        : []),
    ]),
  );
  const syncMs = settings.daemonSyncSeconds * 1000;
  const tickMs = settings.daemonTickSeconds * 1000;
  const watch =
    settings.sendTransport === "gmail"
      ? async (sender: string) =>
          noPush.has(sender)
            ? null
            : gmail.watch(sender, gmailPushTopic(googleKey(keyPath).clientEmail))
      : undefined;
  const sendingDomains = [...new Set(roster.map((s) => senderDomain(s)))];
  const services: AnyService[] = [
    // A plain key is one of Wren's inboxes; `<client>/<mailbox>` is a client's (R4, R12:
    // its mailboxes are in Wren's Workspace, so the same transport and reader serve them).
    makeSendScheduler({
      transport,
      // Email sequences first (its caps), else reactivation's; neither = the loop stops.
      scopeOf: async (key) =>
        clientOfKey(key)
          ? ((await sequencesSendScope(clients, key)) ?? (await clientSendScope(clients, key)))
          : wrenScope(),
      tickMs,
      ...emailNotify,
    }),
    makeInboxScheduler({
      reader,
      scopeOf: (key) => {
        const owner = clientOfKey(key);
        return owner
          ? {
              db: clientDb(owner.client),
              disposition: clientKey(owner.client, "replies"),
              // A bounce or opt-out in a client's inbox suppresses everywhere.
              shared: sharedFor(db, owner.client),
              client: owner.client,
            }
          : { db, disposition: DISPOSITION_KEY, client: null };
      },
      syncMs,
      tickMs,
      classify,
      ...(watch ? { watch } : {}),
      // Instantly's inboxes never send from here, so no reply waits on them, and Instantly
      // pushes only its own campaigns' replies (designs/2026-10-11-push-not-poll.md).
      quiet: (sender) => instantlyInboxes.includes(sender),
      ...emailNotify,
      fire: fireAll,
    }),
    inboxPush,
    makeDisposition({
      dbOf: (key) => {
        const owner = clientOfKey(key);
        return owner ? clientDb(owner.client) : db;
      },
      llm,
      // A client's replies on its own model key or Wren's, metered on its share.
      clientLlm: (client, part) =>
        meteredModel(llm, {
          main: db,
          client,
          part,
          now: () => new Date(),
          store: keys,
          own: llmForKey,
          unset: "managed",
        }),
      tracer,
      tracing: settings.tracing,
      // Code proposes each warm reply's answer; only William's approve books or sends.
      invites: calendar
        ? { calendar, notifier: replyNotifier, copies: campaigns, send: { transport, fleet } }
        : null,
      // A client's warm replies on its sequences (email.replies): the same proposals, its
      // mailboxes, Wren's approve. Its mail offers no times, so nothing is booked by code.
      clientInvites: async (client) => {
        const on = await clientReplies(db, client);
        if (!on?.settings.niche) return null;
        const bookings = on.calcom ? clientBookings(on.calcom) : null;
        const clientCalendar: Calendar = {
          name: bookings ? "cal.com (client)" : "none",
          open: async () => [],
          book: async () => {
            throw new Error("a client's mail offers no times: nothing to book");
          },
          booked: async (email) => (bookings ? bookings.booked(email) : false),
        };
        return {
          calendar: clientCalendar,
          notifier: replyNotifier,
          copies: campaigns,
          send: { transport, fleet: senderFleet(on.settings) },
          niches: [on.settings.niche],
        };
      },
    }),
    // cal.com's booking webhook, through the phone Worker: a booked lead stops getting mail.
    // A client's comes in by its own path and secret, into its database.
    makeCallBookings({ db, clientDb, fire: fireAll }),
    // The lander's signup form and preference center, through the phone Worker. Wren's own
    // lists only; the confirm email goes from portal@.
    makeMarketing({
      db,
      shared: settings.siteExportToken ?? null,
      site: settings.siteBaseUrl.replace(/\/+$/, ""),
      send: portalMail,
      clientDb,
    }),
    // A blog post mailed to its confirmed subscribers, once each (designs/2026-10-11-newsletter.md).
    makeNewsletter({
      db,
      shared: settings.siteExportToken ?? null,
      site: settings.siteBaseUrl.replace(/\/+$/, ""),
      from: settings.portalFrom ?? null,
      postal: settings.marketingPostal ?? null,
      send: portalMail,
      ...(lm ? { listmonk: lm, syncTopic: (topic) => syncTopicByName({ db, lm }, topic) } : {}),
    }),
    // Listmonk (designs/2026-10-21-esign-and-newsletter.md): its postback door, the mail it sends
    // through portal@, and the hourly sync of lists. Without Listmonk's config the door answers
    // and mails nothing, and the sync stays off.
    makeListmonkIntake(),
    makeListmonkMail({
      db,
      shared: settings.siteExportToken ?? null,
      site: settings.siteBaseUrl.replace(/\/+$/, ""),
      from: settings.portalFrom ?? null,
      postal: settings.marketingPostal ?? null,
      send: portalMail,
    }),
    makeListmonkSync({ db, lm }),
  ];
  // The queue-keeper is bound only when asked to hold a queue; 0 means every enrollment is by hand.
  if (settings.composeDaysAhead > 0) {
    services.push(
      makeComposeScheduler({
        db,
        policy,
        campaigns,
        daysAhead: settings.composeDaysAhead,
        verificationHorizonDays: settings.verificationHorizonDays,
        trackOpens: settings.openTracking,
        roleInboxNeedsVerdict: freeVerdicts,
        clientDb,
        ...emailNotify,
      }),
    );
  }
  // Deploy calls it once the new version is registered: queued mail takes the new templates.
  services.push(makeQueueRefresh({ db, campaigns, trackOpens: settings.openTracking }));
  const mailDomains = mailDomainTargets(roster, mailboxes, settings.siteBaseUrl);
  if (settings.notify !== "none")
    services.push(
      makeDigestScheduler({
        db,
        notifier: laneNotifier(settings.discordEmailWebhookUrl),
        policy,
        probers: proberHosts(settings.smtpProbeUrl),
        domains: mailDomains,
        ramps: fleet.ramps ?? {},
        placement: settings.placementSeeds.length > 0,
      }),
    );
  // A plain note and the newest opener from each ramped inbox to the seed Gmails once a send
  // day, read back from their labels; a failing plain test pauses the domain.
  // Off until `PlacementScheduler/fleet/start`, idle with no seeds.
  services.push(
    makePlacementScheduler({
      db,
      policy,
      transport,
      fleet,
      niches: Object.fromEntries(roster.map((s) => [s.address, s.niches])),
      seeds: settings.placementSeeds,
      notifier: laneNotifier(settings.discordEmailWebhookUrl),
      sitesFor: (ctx) =>
        restateSites(ctx, {
          caller: "wren:placement",
          ...sitesHost(settings.autobrowseInstanceId),
          limitMs: LIMITS.read,
        }),
    }),
  );
  // Bound only when configured: an object with nothing to pull is better absent than failing every pass.
  if (postmaster) {
    services.push(
      // A client's `PostmasterScheduler/<client>/daily` reads its verified domains into its database.
      makePostmasterScheduler({
        db,
        client: postmaster,
        domains: sendingDomains,
        policy,
        clientDb,
      }),
    );
  }
  // Tracking off: only mail sent while it was on can still open, so hourly is enough.
  const opensMs = settings.openTracking ? syncMs : 3_600_000;
  if (opens) services.push(makeOpensScheduler({ db, ...opens, syncMs: opensMs, tickMs }));
  // Email link clicks, counted hourly from the lander's views into `email_clicks` (the sent log's "clicked").
  if (settings.siteExportToken)
    services.push(
      makeClicksScheduler({
        db,
        baseUrl: settings.siteBaseUrl,
        exportToken: settings.siteExportToken,
      }),
    );
  if (report) services.push(makeReportScheduler({ db, transport, mail: report, policy }));
  services.push(
    makeEmailConsole({
      db,
      senders: roster.map((s) => s.address),
      policy,
      clients,
    }),
  );
  return services;
}
