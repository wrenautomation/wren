/**
 * The content channels per invocation and a client's, Meta ads' dependencies, and where
 * Reddit calls go: what `Content`, `Ads` and the research chain are wired with.
 */
import { linkedinContent } from "@wren/channel-linkedin";
import {
  facebookContent,
  instagramContent,
  instagramWebContent,
  threadsContent,
} from "@wren/channel-meta";
import type { makeAds } from "@wren/channel-meta/restate";
import { redditApi, redditContent } from "@wren/channel-reddit";
import { tiktokContent } from "@wren/channel-tiktok";
import { xContent } from "@wren/channel-x";
import { youtubeContent } from "@wren/channel-youtube";
import type { Settings } from "@wren/config";
import { clientContent, s3MediaHost } from "@wren/content";
import { businessProfileContent, connectionIdOf } from "@wren/content/connect";
import { findClient, sendsOn } from "@wren/core/clients";
import { asAccount, type Platform, type SiteClient } from "@wren/core/content";
import { sitesHost } from "@wren/core/content/box";
import {
  type ChannelsFor,
  type ContentClients,
  DESK,
  journaledHost,
  journaledSites,
  restateSites,
} from "@wren/core/content/restate";
import type { KeyStore } from "@wren/core/keys";
import { meteredSites } from "@wren/core/metered";
import { dbSendJournal } from "@wren/core/send-journal";
import type { Db } from "@wren/db";
import type { Logger } from "pino";

/**
 * Where Reddit calls go when `reddit` is on: its API with wren's own token
 * when WREN_REDDIT_* is set, else the Mac's desk worker (Reddit refused Wren
 * an API client on 2026-09-29; its browser legs need a home IP). Null when off.
 */
function redditFrom(
  settings: Settings,
  on: readonly string[],
  log: Logger,
): SiteClient | "desk" | null {
  if (!on.includes("reddit")) return null;
  const { redditClientId, redditClientSecret, redditRefreshToken, redditUsername } = settings;
  if (!redditClientId || !redditClientSecret || !redditRefreshToken || !redditUsername) {
    log.info("reddit through the Mac's desk worker (no WREN_REDDIT_* API client)");
    return "desk";
  }
  return redditApi({
    clientId: redditClientId,
    clientSecret: redditClientSecret,
    refreshToken: redditRefreshToken,
    username: redditUsername,
  });
}

/** The content channels per invocation, or null (with one log line) when none is configured. */
export function contentFor(settings: Settings, log: Logger, db: Db): ChannelsFor | null {
  const on = settings.contentChannels;
  if (on.length === 0) {
    log.info("WREN_CONTENT_CHANNELS empty: no Content service");
    return null;
  }
  const sitesAt = sitesHost(settings.autobrowseInstanceId);
  log.info({ sites: sitesAt.service.name }, "autobrowse sites host");
  const signer = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  log.info({ mediaBucket: settings.mediaBucket ?? "none" }, "media host");
  // Reddit: its API with wren's own token, or the Mac's desk worker, whatever the sites host.
  const reddit = redditFrom(settings, on, log);
  return (ctx, o) => {
    const arm = o?.arm ? { arm: true } : {};
    const host = signer ? journaledHost(ctx, signer) : undefined;
    const meta = {
      ...(host ? { host } : {}),
      ...(settings.metaPageId ? { pageId: settings.metaPageId } : {}),
      // With the Page id too, no `me/accounts` read before a post, list or inbox pass.
      ...(settings.metaIgId ? { igId: settings.metaIgId } : {}),
    };
    const base = restateSites(ctx, { caller: "wren:content", ...sitesAt, ...arm });
    // A person's pick on the draft (`reddit@alt`): that platform's channel posts as it.
    const picked = (platform: string) =>
      o?.account?.startsWith(`${platform}@`) ? o.account : null;
    const as = (platform: string, s: SiteClient) => {
      const account = picked(platform);
      return account ? asAccount(s, account) : s;
    };
    return {
      // Wren's own login (William, 10-06): bare `linkedin` is his personal account, never used here.
      ...(on.includes("linkedin")
        ? {
            linkedin: linkedinContent(
              asAccount(base, picked("linkedin") ?? "linkedin@wren"),
              host ? { host } : {},
            ),
          }
        : {}),
      // A picked Reddit account posts through the desk's browser: the API token is one user's.
      ...(reddit
        ? {
            reddit: redditContent(
              reddit === "desk" || picked("reddit")
                ? as("reddit", restateSites(ctx, { caller: "wren:content", service: DESK, ...arm }))
                : journaledSites(ctx, reddit, dbSendJournal(db)),
            ),
          }
        : {}),
      ...(on.includes("youtube")
        ? { youtube: youtubeContent(as("youtube", base), host ? { host } : {}) }
        : {}),
      ...(on.includes("x") ? { x: xContent(as("x", base), host ? { host } : {}) } : {}),
      // The Graph path needs a hosted URL and a Facebook Page (WREN_META_PAGE_ID);
      // until both exist the browser composer posts, fetching the signed URL itself.
      ...(on.includes("instagram")
        ? {
            instagram:
              host && settings.metaPageId
                ? instagramContent(as("instagram", base), meta)
                : instagramWebContent(as("instagram", base), host ? { host } : {}),
          }
        : {}),
      // Wren's Page token holds `pages_read_user_content` (consent 10-22): its comments read too.
      ...(on.includes("facebook")
        ? { facebook: facebookContent(as("facebook", base), { ...meta, pageComments: true }) }
        : {}),
      ...(on.includes("threads")
        ? { threads: threadsContent(as("threads", base), host ? { host } : {}) }
        : {}),
      // The Content Posting API (audited 2026-10-23); WREN_TIKTOK_POST_VIA=web falls back to Studio in the box's browser.
      ...(on.includes("tiktok")
        ? {
            tiktok: tiktokContent(as("tiktok", base), {
              ...(host ? { host } : {}),
              postVia: settings.tiktokPostVia,
            }),
          }
        : {}),
    };
  };
}

/**
 * A client's content channels: its connected accounts on each platform's API, and its own
 * LinkedIn and Reddit autobrowse logins only where Wren's are on (WREN_CONTENT_CHANNELS, the
 * autobrowse channels). Every read goes through its vendor gate. Posts wait on its live flag.
 */
export function contentClientsFor(
  settings: Settings,
  db: Db,
  clientDb: (id: string) => Db,
  keys: KeyStore | null,
  social: SiteClient,
): ContentClients {
  const on = settings.contentChannels;
  const sitesAt = sitesHost(settings.autobrowseInstanceId);
  const signer = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  return {
    channels: async (ctx, client, part) => {
      const hosted = signer ? { host: journaledHost(ctx, signer) } : {};
      const { logins, connected } = await ctx.run(`${client} logins`, async () => {
        const c = await clientContent(db, client, part);
        return c.kind === "work"
          ? { logins: c.logins, connected: c.connected }
          : { logins: {}, connected: {} };
      });
      const scope = {
        main: db,
        client,
        part,
        now: () => new Date(),
        step: <T>(name: string, fn: () => Promise<T>) => ctx.run(name, fn),
        store: keys,
      };
      const metered = (sites: SiteClient, account: string) =>
        asAccount(meteredSites(sites, scope), account);
      const caller = `wren:content:${client}`;
      // A connected account (`social:<id>`): its platform's API, each call one journaled step.
      const own = (p: Platform) => {
        const login = logins[p];
        return login && connectionIdOf(login) !== null
          ? metered(journaledSites(ctx, social, dbSendJournal(clientDb(client))), login)
          : null;
      };
      const yt = own("youtube");
      const x = own("x");
      const ig = own("instagram");
      const fb = own("facebook");
      const tt = own("tiktok");
      const li = own("linkedin");
      const gb = own("google_business");
      const orgUrn = connected.linkedin?.extra.orgUrn;
      const location = connected.google_business?.extra.location;
      return {
        ...(yt ? { youtube: youtubeContent(yt, hosted) } : {}),
        ...(x ? { x: xContent(x, hosted) } : {}),
        ...(ig ? { instagram: instagramContent(ig, hosted) } : {}),
        ...(fb ? { facebook: facebookContent(fb, { ...hosted, pageComments: true }) } : {}),
        ...(tt ? { tiktok: tiktokContent(tt, { ...hosted, direct: true }) } : {}),
        ...(li
          ? {
              linkedin: linkedinContent(li, {
                ...(orgUrn ? { organization: orgUrn } : { direct: true }),
                ...hosted,
              }),
            }
          : {}),
        ...(gb && location
          ? { google_business: businessProfileContent(gb, { location, ...hosted }) }
          : {}),
        ...(!li && logins.linkedin && on.includes("linkedin")
          ? {
              linkedin: linkedinContent(
                metered(restateSites(ctx, { caller, ...sitesAt }), logins.linkedin),
                hosted,
              ),
            }
          : {}),
        ...(logins.reddit && on.includes("reddit")
          ? {
              reddit: redditContent(
                metered(restateSites(ctx, { caller, service: DESK }), logins.reddit),
              ),
            }
          : {}),
      };
    },
    sends: async (client) => {
      const c = await findClient(db, client);
      return !!c && sendsOn(c, "content.posting");
    },
  };
}

/** The `Ads` service's dependencies: the sites host (as the content channels), the account and Page. */
export function adsFor(settings: Settings): Parameters<typeof makeAds>[0] {
  const sitesAt = sitesHost(settings.autobrowseInstanceId);
  const host = settings.mediaBucket ? s3MediaHost({ bucket: settings.mediaBucket }) : undefined;
  return {
    sitesFor: (ctx) => restateSites(ctx, { caller: "wren:ads", ...sitesAt }),
    ...(settings.metaAdAccountId ? { adAccountId: settings.metaAdAccountId } : {}),
    ...(settings.metaPageId ? { pageId: settings.metaPageId } : {}),
    ...(host ? { host } : {}),
  };
}
