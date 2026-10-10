/**
 * Comments and reviews on a client's own connected accounts (designs/2026-10-07-client-social.md):
 * a LinkedIn company page and a Business Profile connect with a fake LinkedIn and a fake Google,
 * SocialWatch reads the page's post comments and the Profile's reviews into the client's own
 * `comments` while Wren runs no channel of its own, and an answer to a review goes out through
 * the client's Profile. Synthetic clients and ids only; no network.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addClient, addMember, findClient, sendsOn, updateClient } from "@wren/core/clients";
import { asAccount, fakeContentChannel, type Platform, type SiteClient } from "@wren/core/content";
import { type Channels, makeContent } from "@wren/core/content/restate";
import { pgKeyStore, throwawayRing } from "@wren/core/keys";
import type { Viewer } from "@wren/core/portal";
import type { PassOutcome } from "@wren/core/restate";
import { spineRecorder, startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { comments } from "@wren/outreach";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientContent } from "../../src/clients.js";
import { liveConnections, socialAccess } from "../../src/connect/access.js";
import { businessProfileContent } from "../../src/connect/business.js";
import { socialConsoleApi } from "../../src/connect/console.js";
import { liveFrom, SOCIAL } from "../../src/connect/platforms.js";
import { socialSites } from "../../src/connect/sites.js";
import { clientRoute } from "../../src/inbox/routes.js";
import { addIdea, contentDrafts } from "../../src/index.js";
import { makeAutoReply } from "../../src/restate/auto-reply.js";
import { makeSocialWatch, type SocialStats } from "../../src/restate/social.js";
import { makeSocialInbox } from "../../src/restate/social-inbox.js";

const ORG = "urn:li:organization:5";
const LOC = "accounts/1/locations/2";
const POST = "urn:li:share:1";
const AMY = "amy@omicron.example.test";
const products = { "content.social": {}, "content.posting": {} };

/** LinkedIn and Google, as far as connecting needs them; reviews and answers on the Profile. */
const google = { answered: [] as { url: string; body: string }[] };
const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
  if (url === SOCIAL.linkedin_page.token)
    return Response.json({
      access_token: "li-SYNTHETIC",
      expires_in: 5_184_000,
      refresh_token: "li-refresh",
      refresh_token_expires_in: 31_536_000,
    });
  if (url.includes("/rest/organizationAcls"))
    return Response.json({ elements: [{ organization: ORG }] });
  if (url.endsWith("/rest/organizations/5"))
    return Response.json({ localizedName: "Omicron Roofing", vanityName: "omicron" });
  if (url === SOCIAL.google_business.token)
    return Response.json({
      access_token: "g-SYNTHETIC",
      refresh_token: "g-refresh",
      expires_in: 3600,
    });
  if (url.endsWith("/v1/accounts"))
    return Response.json({ accounts: [{ name: "accounts/1", accountName: "Omicron" }] });
  if (url.includes("/accounts/1/locations?"))
    return Response.json({ locations: [{ name: "locations/2", title: "Omicron Roofing" }] });
  if (url.startsWith(`https://mybusiness.googleapis.com/v4/${LOC}/reviews?`))
    return Response.json({
      reviews: [
        {
          name: `${LOC}/reviews/r1`,
          reviewer: { displayName: "Sam Test" },
          starRating: "FOUR",
          comment: "Fixed the leak fast",
          createTime: new Date().toISOString(),
          updateTime: new Date().toISOString(),
        },
      ],
    });
  if (url.endsWith(`/v4/${LOC}/reviews/r1/reply`) && init?.method === "PUT") {
    google.answered.push({ url, body: String(init.body) });
    return Response.json({ comment: "ok" });
  }
  return new Response("{}", { status: 404 });
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
let omicron: Db;
const spine = spineRecorder();
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const apps = async () => ({
  linkedin_pages: { id: "lp-app", secret: "lp-secret" },
  google: { id: "g-app", secret: "g-secret" },
});
const access = () =>
  socialAccess({
    main: pg.db,
    apps,
    keys: pgKeyStore(pg.db, throwawayRing()),
    origin: "https://app.test",
    fetch,
    live: liveFrom("linkedin_page,google_business"),
  });
let api: ReturnType<typeof access>;
const sitesOf = (): SiteClient =>
  socialSites({ connection: api.connection, tokenOf: api.tokenOf, broke: api.broke, fetch });

/** The page's comments, from a fake: the adapter's own reads are its unit tests'. */
const page = fakeContentChannel("linkedin");

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, { id: "omicron", name: "Omicron", products });
  await addMember(pg.db, "omicron", AMY, { role: "owner" });
  omicron = open("omicron");
  api = access();
  env = await startTestRestate({
    services: [
      spine.service,
      makeContent(() => ({}), {
        channels: async (_ctx, client): Promise<Channels> => {
          const c = await clientContent(pg.db, client, "content.social");
          if (c.kind !== "work") return {};
          const login = c.logins.google_business;
          const location = c.connected.google_business?.extra.location;
          return {
            ...(c.connected.linkedin?.extra.orgUrn ? { linkedin: page } : {}),
            ...(login && location
              ? {
                  google_business: businessProfileContent(asAccount(sitesOf(), login), {
                    location,
                  }),
                }
              : {}),
          };
        },
        sends: async (client) => {
          const c = await findClient(pg.db, client);
          return !!c && sendsOn(c, "content.posting");
        },
      }),
      // Wren runs no channel of its own: a connected account doesn't wait on that.
      makeSocialWatch({ db: pg.db, platforms: [], zone: "UTC", clientDb: open }),
      makeSocialInbox({ main: pg.db, clientDb: open, access: api, sites: () => sitesOf() }),
      // Reviews just read go to AutoReply; with no model it drafts nothing.
      makeAutoReply({ db: pg.db, clientDb: open, llm: null, senderName: "Wren" }),
    ],
    disableRetries: true,
  });
}, 240_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const watch = () =>
  ingress()
    .objectClient<{ sync: () => Promise<unknown> }>({ name: "SocialWatch" }, "omicron/social")
    .sync() as Promise<PassOutcome<SocialStats>>;
const as = { viewer: { email: AMY } as Viewer, client: "omicron" };
const connect = async (platform: "linkedin_page" | "google_business") => {
  const { url } = await socialConsoleApi({ main: pg.db, access: api }).connect({ ...as, platform });
  const state = new URL(url).searchParams.get("state") ?? "";
  return api.land({ platform, state, code: `code-${platform}` });
};

describe("a client's company page and Business Profile", () => {
  it("connect: the page by its URN, the Profile by its location", async () => {
    expect(await connect("linkedin_page")).toMatchObject({ ok: true, client: "omicron" });
    expect(await connect("google_business")).toMatchObject({ ok: true, client: "omicron" });
    const conns = await liveConnections(pg.db, "omicron");
    expect(conns.map((c) => [c.platform, c.externalId, c.extra]).sort()).toEqual([
      ["google_business", LOC, { location: LOC }],
      ["linkedin_page", "5", { orgUrn: ORG }],
    ]);
    const plan = await clientContent(pg.db, "omicron", "content.social");
    expect(plan).toMatchObject({
      kind: "work",
      platforms: ["linkedin", "google_business"],
      comments: ["linkedin"],
      reviews: ["google_business"],
      dms: [],
    });
  });

  it("SocialWatch reads the page's comments and the Profile's reviews into its comments", async () => {
    await omicron.insert(contentDrafts).values({
      ideaId: (await addIdea(omicron, "roof tips", "cli")).id,
      platform: "linkedin" as Platform,
      text: "Three signs your roof needs work",
      status: "published",
      promptVersion: "test",
      publishedId: POST,
      publishedAt: new Date(),
    });
    page.receive({
      id: "urn:li:comment:(urn:li:share:1,77)",
      postId: POST,
      author: "Lee Test",
      text: "Do you do flat roofs?",
      at: new Date().toISOString(),
    });
    const out = await watch();
    expect(out.error).toBeNull();
    expect(out.stats).toMatchObject({ comments: 2, reviews: 1, errors: [] });
    const rows = await omicron.select().from(comments);
    expect(rows.map((r) => [r.platform, r.post, r.author, r.body]).sort()).toEqual([
      ["google_business", LOC, "Sam Test", "4/5 stars. Fixed the leak fast"],
      ["linkedin", POST, "Lee Test", "Do you do flat roofs?"],
    ]);
    // Read again: nothing new.
    expect((await watch()).stats).toMatchObject({ comments: 0, reviews: 0 });
  });

  it("both answer from its Inbox, and a review's answer goes through its own Profile", async () => {
    const live = [
      { platform: "linkedin_page", state: "connected" },
      { platform: "google_business", state: "connected" },
    ];
    expect(clientRoute("comment", "linkedin", live)).toBeNull();
    expect(clientRoute("comment", "google_business", live)).toBeNull();
    await updateClient(pg.db, "omicron", { sends: ["content.posting"] });
    const [review] = await omicron
      .select()
      .from(comments)
      .where(eq(comments.platform, "google_business"));
    await ingress()
      .serviceClient<ReturnType<typeof makeSocialInbox>>({ name: "SocialInbox" })
      .answer({ client: "omicron", id: review?.id ?? 0, body: "Thanks, Sam." });
    expect(google.answered).toEqual([
      {
        url: `https://mybusiness.googleapis.com/v4/${LOC}/reviews/r1/reply`,
        body: JSON.stringify({ comment: "Thanks, Sam." }),
      },
    ]);
    const [after] = await omicron
      .select()
      .from(comments)
      .where(eq(comments.id, review?.id ?? 0));
    expect(after).toMatchObject({ state: "answered", answer: "Thanks, Sam." });
  });
});
