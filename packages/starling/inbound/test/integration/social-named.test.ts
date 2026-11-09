/**
 * SocialActivityRead with a live tab watcher on LinkedIn (designs/2026-10-12-push-everywhere.md, 10-31):
 * posts are read when a notification names them, else on the net, one a pass. Without a beat the
 * clock reads them as before.
 */

import { ingressOf } from "@wren/config";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRuntime, type TestRuntime } from "@wren/core/testing";
import { seedObjects, startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import * as restate from "@wren/runtime";
import * as clients from "@wren/runtime/clients";
import { type ContentChannel, fakeContentChannel } from "@wren/starling-core";
import { makeContentPublish } from "@wren/starling-core/service";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addIdea, contentDrafts } from "../../src/index.js";
import type { SocialStats } from "../../src/restate/social.js";
import { makeSocialActivityRead, SOCIAL_KEY } from "../../src/restate/social.js";
import { makeSocialPush, socialPushed } from "../../src/restate/social-push.js";

const DAY = 86_400_000;
const A = "urn:li:ugcPost:7000000000000000001";
const B = "urn:li:ugcPost:7000000000000000002";
const C = "urn:li:ugcPost:7000000000000000003";
// The second test's posts: SocialActivityRead's state outlives a test.
const D = "urn:li:ugcPost:7000000000000000004";
const E = "urn:li:ugcPost:7000000000000000005";
const F = "urn:li:ugcPost:7000000000000000006";
const G = "urn:li:ugcPost:7000000000000000007";
const H = "urn:li:ugcPost:7000000000000000008";
let li = fakeContentChannel("linkedin");
let channels: Record<string, ContentChannel> = {};
/** Each post's comment read, in order. */
const reads: string[] = [];
const leases: string[] = [];
const fakeExecutor = restate.service({
  name: "Executor",
  handlers: { emit: async () => ({}) },
});
/** A DM push wakes ReachInboxRead: it stands in. */
const fakeReachInboxRead = restate.object({
  name: "ReachInboxRead",
  handlers: { wake: async () => {} },
});
const fakeDesk = restate.service({
  name: "desk",
  handlers: {
    watch: async (_ctx: restate.Context, lease: { account: string }) => {
      leases.push(lease.account);
      return {};
    },
  },
});

let pg: TestPostgres;
let env: TestRuntime;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRuntime({
    services: [
      fakeExecutor,
      fakeDesk,
      fakeReachInboxRead,
      makeContentPublish(() => channels),
      socialPushed,
      makeSocialPush({ db: pg.db, ours: {} }),
      makeSocialActivityRead({
        db: pg.db,
        platforms: ["linkedin"],
        zone: "America/New_York",
        watched: { linkedin: "linkedin@wren" },
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "content_ideas",
    "content_drafts",
    "comments",
    "social_activity",
    "social_days",
    "touches",
    "social_handles",
  ]);
  reads.length = 0;
  li = fakeContentChannel("linkedin");
  const fake = li;
  channels = {
    linkedin: {
      ...fake,
      comments: async (id, q) => {
        reads.push(id);
        return fake.comments(id, q);
      },
    },
  };
});

const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const sync = () =>
  ingress()
    .objectClient<ReturnType<typeof makeSocialActivityRead>>(
      { name: "SocialActivityRead" },
      SOCIAL_KEY,
    )
    .sync() as Promise<PassOutcome<SocialStats>>;
const push = () =>
  ingress().serviceClient<ReturnType<typeof makeSocialPush>>({ name: "SocialPushIntake" });

async function published(id: string, days: number) {
  const idea = await addIdea(pg.db, `idea ${id}`, "cli");
  await seedObjects(pg.db, [{ platform: "linkedin", ref: id, kind: "post" }]);
  await pg.db.insert(contentDrafts).values({
    ideaId: idea.id,
    platform: "linkedin",
    text: `Post ${id}\nmore`,
    status: "published",
    publishedId: id,
    publishedAt: new Date(Date.now() - days * DAY),
    url: `https://linkedin.test/p/${id}`,
    promptVersion: "test",
  });
}

describe("SocialActivityRead, LinkedIn watched", () => {
  it("no beat: the clock reads every due post; a beat: only the post a notification names", async () => {
    await published(A, 1);
    await published(B, 1);
    await published(C, 5);

    // No beat yet: every due post on the clock, the watcher leased.
    const first = await sync();
    expect(first.error).toBeNull();
    expect(new Set(reads)).toEqual(new Set([A, B, C]));
    expect(leases).toContain("linkedin@wren");

    // A beat: read all three a moment ago, so nothing is due on the net.
    await push().watch({ owner: SOCIAL_KEY, platform: "linkedin", kind: "alive" });
    reads.length = 0;
    const second = await sync();
    expect(second.stats?.posts).toBe(0);
    expect(reads).toEqual([]);

    // A comment on B and its notification: the rise reads activity, then only B.
    li.receive({
      id: "8001",
      postId: B,
      author: "Reader One",
      text: "How do you handle this?",
      at: new Date().toISOString(),
      raw: {},
    });
    li.happen({
      id: "n-1",
      kind: "notification",
      actor: "Reader One",
      actorUrl: null,
      text: "Reader One commented on your post.",
      url: `https://www.linkedin.com/feed/update/${B}/?commentUrn=urn%3Ali%3Acomment%3A1`,
      at: new Date().toISOString(),
      raw: {},
    });
    await push().watch({ owner: SOCIAL_KEY, platform: "linkedin", kind: "activity" });
    const named = await sync();
    expect(named.error).toBeNull();
    expect(reads).toEqual([B]);
    expect(named.stats).toMatchObject({ posts: 1, comments: 1, activity: 1 });
    expect(named.stats?.unnamed).toBeUndefined();

    // Named once: the next pass leaves B alone.
    reads.length = 0;
    await sync();
    expect(reads).toEqual([]);
  });

  it("the net reads one post a pass, newest first, four a day, and counts what no notification named", async () => {
    await published(D, 0.5);
    await published(E, 1);
    await published(F, 1.5);
    await published(G, 2);
    await published(H, 2.5);
    await push().watch({ owner: SOCIAL_KEY, platform: "linkedin", kind: "alive" });
    li.receive({
      id: "8002",
      postId: D,
      author: "Reader Two",
      text: "Nice",
      at: new Date().toISOString(),
      raw: {},
    });
    // Never read: both are due on the net, one a pass.
    const one = await sync();
    expect(reads).toEqual([D]);
    expect(one.stats?.unnamed).toBe(1);
    await sync();
    expect(reads).toEqual([D, E]);
    for (let i = 0; i < 4; i++) await sync();
    // Four today: H waits for tomorrow's net.
    expect(reads).toEqual([D, E, F, G]);
  });
});
