/**
 * Content: the Blog box and Pieces, the channels, the content loop (desk,
 * scheduler, metrics, planner), the social inbox and desk, auto-reply, comment keywords and
 * the site chat.
 */

import { asAccount, type Platform } from "@wren/core/autobrowse";
import { DESK, restateSites } from "@wren/core/autobrowse/restate";
import { runtimeAdmin } from "@wren/core/console";
import { pausedUnder } from "@wren/core/dead-letters";
import { wrenFacts } from "@wren/core/facts";
import { githubRepo } from "@wren/core/github";
import { LIMITS } from "@wren/core/restate";
import { placeIdOf } from "@wren/delivery/sms";
import { liveCampaignsOf } from "@wren/pipeline/store";
import type { ObjectContext } from "@wren/runtime";
import { makeDraftAsk } from "@wren/starling-acts/restate";
import { markAnswered } from "@wren/starling-conversations";
import { makeAutoReply, makeChat, makeInboxDesk } from "@wren/starling-conversations/restate";
import { makeContent } from "@wren/starling-core/service";
import { isGoogleMailbox } from "@wren/starling-email/access/access";
import { slidePainter } from "@wren/starling-inbound";
import { liveConnections, loginOf } from "@wren/starling-inbound/connect";
import {
  makeBlog,
  makeClientReport,
  makeContentDesk,
  makeKeywordDm,
  makeMarketingConsole,
  makeMetaPace,
  makePieces,
  makePostMetrics,
  makePostPlan,
  makePostPublish,
  makePushedComments,
  makeSocialActivityRead,
  makeSocialDesk,
  makeSocialPush,
  makeVideoDesk,
  socialPushed,
} from "@wren/starling-inbound/restate";
import { draftDm } from "@wren/starling-outbound";
import { wakeWatch } from "@wren/starling-outbound/restate";
import { tiktokCreator } from "@wren/starling-tiktok";
import { deskDrafts, deskKinds } from "../desk.js";
import { clientMarketing } from "../marketing.js";
import { contentClientsFor, contentFor } from "./content-channels.js";
import type { AnyService, Deps } from "./deps.js";

/** SocialActivityRead's clock: 07:00-23:00 New York (designs/2026-10-06-social-inbox.md). */
const SOCIAL_ZONE = "America/New_York";

/** The content domain's services, in the order they were served from `services.ts`. */
export function contentServices(deps: Deps): AnyService[] {
  const {
    bookerMailer,
    clientDb,
    db,
    googleLlm,
    keys,
    lane,
    llm,
    log,
    mediaSigner,
    mentionMail,
    openClient,
    operatorText,
    settings,
    socialApi,
    tracer,
    voice,
    watchLlm,
  } = deps;
  const contentNotify = lane(settings.discordContentWebhookUrl);
  const services: AnyService[] = [
    // Write's Blog box: posts committed to the lander repo, then mailed (designs/2026-10-13-blog-box.md).
    makeBlog({
      db,
      repo: settings.landerGithubToken
        ? githubRepo({ token: settings.landerGithubToken, repo: settings.landerRepo })
        : null,
      site: settings.siteBaseUrl.replace(/\/+$/, ""),
      zone: settings.sendTimezone,
    }),
    // Marketing's Today and Pieces: each piece with its branches (designs/2026-10-13-primitives-first.md).
    makePieces({ db, site: settings.siteBaseUrl.replace(/\/+$/, "") }),
  ];
  // Content channels (LinkedIn, YouTube) over autobrowse's `sites` service, as the `Content` service.
  // Bound with no channel of Wren's too: a client's connected accounts post and read through it.
  const content = contentFor(settings, log, db);
  services.push(
    makeContent(
      content ?? (() => ({})),
      contentClientsFor(settings, db, clientDb, keys, socialApi),
    ),
  );
  // Client reports: kept every run; mailed from portal@ only once WREN_CLIENT_REPORTS_MAIL=on.
  const clientReportDeps = {
    records: clientMarketing(mediaSigner),
    zone: settings.sendTimezone,
    reportMail: bookerMailer
      ? {
          send: bookerMailer("Wren"),
          on: settings.clientReportsMail === "on",
          portal: settings.portalOrigin ?? "https://app.wrenautomation.com",
        }
      : undefined,
  };
  // A post's replies come in through reach's watch: it reads warm from now.
  const postedWarm = (ctx: ObjectContext, p: Platform, client: string | null) => {
    if (p === "reddit" || p === "linkedin") wakeWatch(ctx, client);
  };
  // The content loop: ideas → drafts (ContentDesk, paid) → approved drafts posted (PostPublish).
  // Always bound: drafting needs no channel; a publish with none configured fails on its row.
  services.push(
    makeContentDesk({
      db,
      llm,
      posted: postedWarm,
      platforms: settings.contentChannels,
      zone: settings.sendTimezone,
      tracer,
      // A client's drafts: its database, the watch's model metered on its own gate, or its own
      // model key from the store.
      clients: { clientDb, llm: watchLlm, keys },
      ...(voice !== null ? { voice } : {}),
      // A post field's file (thumbnail, subtitles, cover) goes up to the media bucket.
      ...(settings.mediaBucket ? { media: { bucket: settings.mediaBucket } } : {}),
      // A carousel's slides draw on the render tier's chromium: here, or over CDP on the box.
      ...(settings.renderer === "local"
        ? { slides: slidePainter() }
        : settings.renderer === "cdp" && settings.cdpUrl
          ? { slides: slidePainter({ connectUrl: settings.cdpUrl }) }
          : {}),
    }),
    // A client's Marketing in the portal: its drafts, posts, ads and search; verdicts to its desk.
    makeMarketingConsole({
      db,
      open: openClient,
      records: clientMarketing(mediaSigner),
      // A TikTok draft's form reads the client's account live (TikTok's Direct Post rules).
      tiktokCreator: async (client) => {
        const c = (await liveConnections(db, client)).find((r) => r.platform === "tiktok");
        return c ? tiktokCreator(asAccount(socialApi, loginOf(c.id))) : null;
      },
      zone: clientReportDeps.zone,
      reportMail: clientReportDeps.reportMail,
    }),
    // Marketing → Reports: each report wakes on its Monday or 1st and mails its members.
    makeClientReport({
      main: db,
      open: openClient,
      records: clientReportDeps.records,
      mail: clientReportDeps.reportMail,
    }),
    makePostPublish({
      db,
      posted: postedWarm,
      clientDb,
      // A publish held by a paused desk call waits in To approve, not on the queue.
      pausedUnder: pausedUnder(
        runtimeAdmin(db, settings.restateAdminUrl, settings.restateAuthToken).query,
      ),
      ...contentNotify,
    }),
    makePostMetrics({ db, clientDb, ...contentNotify }),
    // Tomorrow's slots vs scheduled drafts, said once a day; off until `wren content planner start`.
    makePostPlan({
      db,
      clientDb,
      zone: settings.sendTimezone,
      liveCampaigns: liveCampaignsOf,
      ...contentNotify,
    }),
    // Comments, activity and followers on our own accounts. Reads only; off until `wren social start`.
    makeSocialActivityRead({
      db,
      clientDb,
      platforms: settings.contentChannels,
      zone: SOCIAL_ZONE,
      ...contentNotify,
      ...(operatorText && settings.notify !== "none" ? { texter: operatorText } : {}),
      // A client's Google reviews off Maps, by its Place ID, when its Profile can't read them.
      maps: {
        placeId: (client) => placeIdOf(db, client),
        sites: (ctx) =>
          restateSites(ctx, { caller: "wren:reviews", service: DESK, limitMs: LIMITS.desk }),
      },
      // Tab watchers on the desk: LinkedIn and X push us nothing (designs/2026-10-12-push-everywhere.md).
      watched: { linkedin: "linkedin@wren", x: "x@wren" },
    }),
    makeSocialDesk({ db, zone: SOCIAL_ZONE }),
    // Webhooks and tab watchers wake the social loops (designs/2026-10-12-push-everywhere.md).
    makeSocialPush({
      db,
      ours: { pageId: settings.metaPageId ?? null, igId: settings.metaIgId ?? null },
      carry: settings.metaPushEvents,
    }),
    // A carried comment kept with no read; private replies paced (designs/2026-11-04-meta-push-flows.md).
    makePushedComments({ db, clientDb }),
    makeMetaPace({ perHour: settings.metaPrivatePerHour }),
    socialPushed,
    // Ask Claude on any draft: the desk's Claude Code rewrites, Wren writes. Nothing sends.
    makeDraftAsk(db, deskKinds, deskDrafts),
    makeVideoDesk(db, { llm }),
    // Reply from the Inbox on the thread's own channel, notes, assignees
    // (designs/2026-10-07-inbox-reply.md). Each send goes through that channel's desk.
    makeInboxDesk({
      db,
      clientDb,
      llm: watchLlm,
      google: googleLlm,
      googleMailbox: (client, address) => isGoogleMailbox(db, client, address),
      keys,
      draftDm,
      markAnswered,
      senderName: settings.smsSenderName,
      facts: () => wrenFacts(db),
      mentionMail,
    }),
  );
  // A reply drafted when someone writes in (designs/2026-10-09-auto-reply.md); Auto is held.
  services.push(
    makeAutoReply({
      db,
      clientDb,
      llm: watchLlm,
      google: googleLlm,
      googleMailbox: (client, address) => isGoogleMailbox(db, client, address),
      keys,
      draftDm,
      senderName: settings.smsSenderName,
      facts: () => wrenFacts(db),
    }),
  );
  // A comment's keyword sends its DM (designs/2026-10-11-comment-keywords.md).
  services.push(makeKeywordDm({ db, clientDb }));
  // The site chat bubble's calls, through the portal Worker (designs/2026-10-09-site-chat.md).
  services.push(makeChat({ db, clientDb }));
  return services;
}
