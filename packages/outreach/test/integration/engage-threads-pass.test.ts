/**
 * Engage threads, one whole `ReachWatch` pass at a time on a real Restate and Postgres
 * (designs/2026-10-15-engage-threads.md): the inbox shows one reply under our comment; the same
 * pass watches the thread, probes its count, reads it in full and keeps the follow-ups the inbox
 * never lists (the replier's self-reply, a third person's deep reply), never the stranger and
 * never ours; one person's messages fold into one row, newest first. A count that held is not
 * read again; a count that moved is. Synthetic handles and posts only.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import type { SiteClient } from "@wren/core/content";
import { journaledSites } from "@wren/core/content/restate";
import { foldRows } from "@wren/core/records";
import type { PassOutcome } from "@wren/core/restate";
import { dbSendJournal } from "@wren/core/send-journal";
import { executorRecorder, startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAccount, setAccountState } from "../../src/accounts.js";
import { COMMENTS_FLOW } from "../../src/comments.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { COMMENT_FOLD, commentRecord } from "../../src/records.js";
import { makeReachWatch, type WatchStats } from "../../src/restate/index.js";
import { comments } from "../../src/schema.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";

const HOUR = 3_600_000;
const START = new Date("2026-10-01T18:00:00Z");
let now = START;
const utc = (minutesAgo: number) => Math.floor((now.getTime() - minutesAgo * 60_000) / 1000);

/** One comment in the thread, as `/comments/{post}` nests it. */
interface Node {
  name: string;
  author: string;
  body: string;
  created_utc: number;
  replies: Node[];
}
const node = (name: string, author: string, body: string, minutesAgo: number): Node => ({
  name,
  author,
  body,
  created_utc: utc(minutesAgo),
  replies: [],
});
const listing = (nodes: Node[]): unknown => ({
  kind: "Listing",
  data: {
    children: nodes.map((n) => ({
      kind: "t1",
      data: {
        name: n.name,
        id: n.name.slice(3),
        author: n.author,
        body: n.body,
        created_utc: n.created_utc,
        permalink: `/r/test/comments/p1/x/${n.name.slice(3)}/`,
        replies: n.replies.length ? listing(n.replies) : "",
      },
    })),
  },
});
const size = (nodes: Node[]): number => nodes.reduce((n, c) => n + 1 + size(c.replies), 0);

// Our comment; replier_a answers it, then replies to their own reply; replier_b replies under
// that; a stranger comments on the post elsewhere.
const ours = node("t1_ours", "wren_test", "Our comment", 60);
const a1 = node("t1_a1", "replier_a", "First reply", 50);
const a2 = node("t1_a2", "replier_a", "And a question?", 40);
const b1 = node("t1_b1", "replier_b", "Same question", 30);
ours.replies.push(a1);
a1.replies.push(a2);
a2.replies.push(b1);
const tree: Node[] = [ours, node("t1_x1", "stranger", "Elsewhere on the post", 20)];

/** The desk, faked: the inbox lists only the direct reply to us. */
const paths: string[] = [];
const sites: SiteClient = {
  async call<T>(_site: string, _method: string, path: string) {
    paths.push(path);
    const count = size(tree);
    const out: unknown =
      path === "/api/v1/me"
        ? { name: "wren_test", total_karma: 40, created_utc: utc(90 * 24 * 60) }
        : path === "/message/inbox"
          ? {
              data: {
                children: [
                  {
                    data: {
                      name: a1.name,
                      author: a1.author,
                      body: a1.body,
                      was_comment: true,
                      parent_id: ours.name,
                      context: "/r/test/comments/p1/x/a1/?context=3",
                      subreddit: "test",
                      link_title: "A synthetic post",
                      created_utc: a1.created_utc,
                    },
                  },
                ],
              },
            }
          : path === "/api/info"
            ? { data: { children: [{ kind: "t3", data: { name: "t3_p1", num_comments: count } }] } }
            : path === "/comments/p1"
              ? [
                  {
                    data: {
                      children: [
                        {
                          kind: "t3",
                          data: {
                            name: "t3_p1",
                            title: "A synthetic post",
                            selftext: "Its words",
                            author: "poster",
                            subreddit: "test",
                            permalink: "/r/test/comments/p1/x/",
                            created_utc: utc(600),
                            num_comments: count,
                          },
                        },
                      ],
                    },
                  },
                  listing(tree),
                ]
              : { data: { children: [] } };
    return out as T;
  },
  via: async () => "api",
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const executor = executorRecorder();
beforeAll(async () => {
  pg = await startTestPostgres();
  const a = await addAccount(pg.db, { platform: "reddit", account: "reddit@test", now });
  await setAccountState(pg.db, a.id, "warming", { reason: null, now });
  await pg.db.execute(`update reach_accounts set handle = 'wren_test' where id = '${a.id}'`);
  env = await startTestRestate({
    services: [
      executor.service,
      makeReachWatch({
        db: pg.db,
        policy: DEFAULT_POLICY,
        sequences: REACH_SEQUENCES,
        live: false,
        senderName: "Test",
        heldNiches: [],
        clock: () => now,
        sitesFor: (ctx) => journaledSites(ctx, sites, dbSendJournal(pg.db)),
      }),
    ],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const pass = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<ReturnType<typeof makeReachWatch>>({ name: "ReachWatch" }, "wren")
    .sync() as Promise<PassOutcome<WatchStats>>;
const rows = async () =>
  (await pg.db.select().from(comments)).map((c) => [c.ref, c.kind, c.author]).sort();
/** Engage's rows as the record serves them: folded per person per thread. */
const folded = async () => foldRows((await commentRecord.rows?.(pg.db)) ?? [], COMMENT_FOLD, "id");
const textsOf = (rs: Record<string, unknown>[], who: string) =>
  (rs.find((r) => r.who === who)?.messages as { text: string }[] | undefined)?.map((m) => m.text);
const reads = () => paths.filter((p) => p === "/comments/p1").length;
/** The comments the passes sent along the comments flow, one event each. */
const emitted = () =>
  executor.emitted.filter((e) => e.workflow === COMMENTS_FLOW).flatMap((e) => e.events);

describe("a whole ReachWatch pass over a thread", () => {
  it("keeps the inbox reply and the follow-ups it never lists, folded per person", async () => {
    const out = await pass();
    expect(out.error).toBeNull();
    expect(out.stats?.comments).toEqual({ kept: 1, errors: [] });
    expect(out.stats?.threads).toEqual({ probed: 1, read: 1, kept: 2, answered: 0, errors: [] });
    // The count probe first, then the one full read.
    expect(paths.indexOf("/api/info")).toBeLessThan(paths.indexOf("/comments/p1"));
    expect(await rows()).toEqual([
      ["t1_a1", "comment_reply", "replier_a"],
      ["t1_a2", "thread_reply", "replier_a"],
      ["t1_b1", "thread_reply", "replier_b"],
    ]);
    const view = await folded();
    expect(view.filter((r) => r.who === "replier_a")).toHaveLength(1);
    expect(textsOf(view, "replier_a")).toEqual(["And a question?", "First reply"]);
    expect(textsOf(view, "replier_b")).toEqual(["Same question"]);
    expect(emitted()).toHaveLength(3);
  });

  it("a count that held: probed, not read, nothing kept twice", async () => {
    now = new Date(START.getTime() + 4 * HOUR);
    const before = reads();
    const out = await pass();
    expect(out.stats?.comments.kept).toBe(0);
    expect(out.stats?.threads).toMatchObject({ probed: 1, read: 0, kept: 0 });
    expect(reads()).toBe(before);
    expect(await rows()).toHaveLength(3);
  });

  it("a count that moved: read again, the new message folds in first", async () => {
    now = new Date(START.getTime() + 8 * HOUR);
    b1.replies.push(node("t1_a3", "replier_a", "Any update?", 10));
    const before = reads();
    const out = await pass();
    expect(out.stats?.threads).toMatchObject({ probed: 1, read: 1, kept: 1 });
    expect(reads()).toBe(before + 1);
    expect(await rows()).toHaveLength(4);
    expect(textsOf(await folded(), "replier_a")).toEqual([
      "Any update?",
      "And a question?",
      "First reply",
    ]);
  });
});
