/**
 * The fbGroups stage on a real Postgres, over a fake `fb-public` and synthetic groups: a search is
 * kept whole and leaves a queue of About and post reads; a cap writes nothing, a refusal is data;
 * a post that names a firm (by link, author or name) becomes a finding on it.
 */
import { companies, people } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  GROUP_READ_BUCKET,
  GROUP_SEARCH_BUCKET,
  groupAboutUnit,
  groupKeywordsDue,
  groupPostUnit,
  groupReadRoom,
  groupReadsDue,
  groupSearchRoom,
  groupSearchUnit,
  mapPosts,
} from "../../src/enrichment/fb-groups.js";
import { findings } from "../../src/schema.js";
import { socialGroups, socialPosts, socialSearches } from "../../src/social-schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "social_searches",
    "social_groups",
    "social_posts",
    "findings",
    "people",
    "companies",
  ]),
);
const db = () => pg.db;

const hit = (post: string, group = "staffing-owners") => ({
  post,
  url: `https://www.facebook.com/groups/${group}/posts/${post}/`,
  title: `Post ${post}`,
  snippet: `Snippet ${post}`,
  shown: "3 days ago",
});
const SEARCH = {
  groups: [
    {
      group: "staffing-owners",
      name: "Staffing Owners Club",
      url: "https://www.facebook.com/groups/staffing-owners/",
      posts: [hit("100001"), hit("100002")],
    },
    {
      group: "123456789",
      name: null,
      url: "https://www.facebook.com/groups/123456789/",
      posts: [{ ...hit("100003", "123456789"), post: "12" }],
    },
  ],
  serp: { query: "q", results: [] },
};
const aboutOf = (name: string) => ({ about: { name, privacy: "Private", members: "1.2K" } });
const postOf = (over: Record<string, unknown>) => ({
  post: { author: "Someone", time: "2 days ago", text: "hello", links: null, ...over },
  comments: [{ author: "Other", text: "me too" }],
});

/** A fake `fb-public`: answers by path, or throws what a path maps to. */
function desk(answers: Record<string, unknown>): SiteClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    via: async () => "browser",
    call: async <T>(site: string, method: string, path: string) => {
      paths.push(path);
      const a = answers[path];
      if (a instanceof Error) throw a;
      if (a === undefined) throw new SiteCallError(site, method, path, 404, "not found");
      return a as T;
    },
  };
}

describe("groupSearchUnit", () => {
  it("keeps the answer whole, the groups and a stub per readable post, and meters the search", async () => {
    const sites = desk({ "/groups": SEARCH });
    const u = await groupSearchUnit(db(), sites, { q: "staffing owners", niche: "n" });
    expect(u).toMatchObject({ outcome: "read", groups: 2, groupsNew: 2, postsNew: 2 });

    const [search] = await db().select().from(socialSearches);
    expect(search).toMatchObject({ keyword: "staffing owners", n: 20, groups: 2 });
    expect(search?.answer).toEqual(SEARCH);
    const groups = await db().select().from(socialGroups).orderBy(socialGroups.id);
    expect(groups.map((g) => [g.ref, g.name, g.readAt])).toEqual([
      ["staffing-owners", "Staffing Owners Club", null],
      ["123456789", null, null],
    ]);
    // A post ref the route would refuse (12) stays in the answer only.
    const posts = await db().select().from(socialPosts).orderBy(socialPosts.id);
    expect(posts.map((p) => [p.ref, p.text, p.readAt])).toEqual([
      ["100001", null, null],
      ["100002", null, null],
    ]);
    expect(posts[0]?.raw).toEqual({ hit: SEARCH.groups[0]?.posts[0] });

    // The same search again: the latest hit, no second group or post.
    const again = await groupSearchUnit(db(), sites, { q: "owners", niche: "n" });
    expect(again).toMatchObject({ groupsNew: 0, postsNew: 0 });
    expect(await db().select().from(socialGroups)).toHaveLength(2);
    expect(await db().select().from(socialPosts)).toHaveLength(2);
    expect((await db().select().from(socialGroups).orderBy(socialGroups.id))[0]?.keyword).toBe(
      "staffing owners",
    );
  });

  it("a cap writes nothing; a refusal is kept so the keyword waits its week", async () => {
    const capped = desk({
      "/groups": new SiteCallError("fb-public", "GET", "/groups", 429, "retry after 3600s"),
    });
    const c = await groupSearchUnit(db(), capped, { q: "a", niche: "n" });
    expect(c.outcome).toBe("capped");
    expect(await db().select().from(socialSearches)).toHaveLength(0);

    const refused = desk({
      "/groups": new SiteCallError("fb-public", "GET", "/groups", 400, "bad query"),
    });
    const r = await groupSearchUnit(db(), refused, { q: "a", niche: "n" });
    expect(r.outcome).toBe("error");
    const [row] = await db().select().from(socialSearches);
    expect(row).toMatchObject({ keyword: "a", groups: 0 });

    // A 5xx is not data: it throws, so the unit retries.
    const down = desk({
      "/groups": new SiteCallError("fb-public", "GET", "/groups", 502, "desk down"),
    });
    await expect(groupSearchUnit(db(), down, { q: "b", niche: "n" })).rejects.toThrow();
  });

  it("a keyword is due again after 7 days, longest ago first, and the bucket counts searches", async () => {
    await groupSearchUnit(db(), desk({ "/groups": SEARCH }), { q: "a", niche: "n" });
    const now = new Date();
    const due = (at: Date, niche = "n") =>
      groupKeywordsDue(db(), niche, ["a", "b"], { now: at, limit: 5 });
    expect(await due(now)).toEqual(["b"]);
    expect(await due(new Date(now.getTime() + 8 * 86_400_000))).toEqual(["b", "a"]);
    expect(await due(now, "other")).toEqual(["a", "b"]);
    expect((await groupSearchRoom(db(), new Date())).room).toBe(GROUP_SEARCH_BUCKET.burst - 1);
  });
});

describe("page reads", () => {
  it("queue a group's About, then its posts, and keep each read whole", async () => {
    await groupSearchUnit(db(), desk({ "/groups": SEARCH }), { q: "q", niche: "n" });
    const now = new Date();
    const queue = await groupReadsDue(db(), "n", { now, limit: 10 });
    expect(queue.map((r) => (r.kind === "about" ? `about ${r.group}` : `post ${r.post}`))).toEqual([
      "about staffing-owners",
      "post 100001",
      "post 100002",
      "about 123456789",
    ]);
    expect(await groupReadsDue(db(), "n", { now, limit: 2 })).toHaveLength(2);
    expect(await groupReadsDue(db(), "other", { now, limit: 10 })).toEqual([]);

    const sites = desk({
      "/groups/staffing-owners": aboutOf("Staffing Owners Club"),
      "/groups/staffing-owners/posts/100001": postOf({
        author: "Ann Example",
        links: "https://a.example",
      }),
      "/groups/staffing-owners/posts/100002": { post: null, comments: [] },
    });
    const [about, p1, p2] = queue;
    expect((await groupAboutUnit(db(), sites, about as never)).outcome).toBe("read");
    expect((await groupPostUnit(db(), sites, p1 as never)).outcome).toBe("read");
    expect((await groupPostUnit(db(), sites, p2 as never)).outcome).toBe("read");

    const [g] = await db()
      .select()
      .from(socialGroups)
      .where(eq(socialGroups.ref, "staffing-owners"));
    expect(g?.about).toEqual(aboutOf("Staffing Owners Club").about);
    expect(g?.readAt).not.toBeNull();
    const posts = await db().select().from(socialPosts).orderBy(socialPosts.id);
    expect(posts[0]).toMatchObject({ author: "Ann Example", posted: "2 days ago", text: "hello" });
    // The stub's own lines stay beside what the page said.
    expect(posts[0]?.raw).toMatchObject({
      hit: SEARCH.groups[0]?.posts[0],
      post: { author: "Ann Example" },
      comments: [{ author: "Other", text: "me too" }],
    });
    // A page that shows nothing is still a read, with no text.
    expect(posts[1]).toMatchObject({ text: null, error: null });
    expect(posts[1]?.readAt).not.toBeNull();

    // Left: only the other group's About; the bucket counts the three reads.
    expect(await groupReadsDue(db(), "n", { now, limit: 10 })).toEqual([
      { kind: "about", groupId: expect.any(Number), group: "123456789" },
    ]);
    expect((await groupReadRoom(db(), new Date())).room).toBe(GROUP_READ_BUCKET.burst - 3);
  });

  it("a refusal is kept with the read; a cap leaves the read in the queue; an About is due again after 30 days", async () => {
    await groupSearchUnit(db(), desk({ "/groups": SEARCH }), { q: "q", niche: "n" });
    const [about, , , other] = await groupReadsDue(db(), "n", { now: new Date(), limit: 10 });
    const gone = desk({}); // every path 404s
    expect((await groupAboutUnit(db(), gone, about as never)).outcome).toBe("error");
    const [g] = await db()
      .select()
      .from(socialGroups)
      .where(eq(socialGroups.ref, "staffing-owners"));
    expect(g?.error).toMatch(/404/);
    expect(g?.readAt).not.toBeNull();

    const capped = desk({
      "/groups/123456789": new SiteCallError(
        "fb-public",
        "GET",
        "/groups/x",
        429,
        "retry after 600s",
      ),
    });
    expect((await groupAboutUnit(db(), capped, other as never)).outcome).toBe("capped");
    const now = new Date();
    const queue = (at: Date) => groupReadsDue(db(), "n", { now: at, limit: 10 });
    expect((await queue(now)).filter((r) => r.kind === "about")).toHaveLength(1);
    // 31 days on, the refused About is due again, after the group never read.
    const later = (await queue(new Date(now.getTime() + 31 * 86_400_000))).filter(
      (r) => r.kind === "about",
    );
    expect(later.map((r) => r.group)).toEqual(["123456789", "staffing-owners"]);
  });
});

describe("mapPosts", () => {
  /** One read post per case, in a group of niche `n`. */
  async function readPost(
    ref: string,
    author: string | null,
    text: string | null,
    links: string | null,
  ) {
    const [g] = await db()
      .insert(socialGroups)
      .values({
        network: "facebook",
        ref: `g${ref}`,
        niche: "n",
        keyword: "q",
        name: "Group",
        url: `https://www.facebook.com/groups/g${ref}/`,
        hit: {},
      })
      .returning();
    await db()
      .insert(socialPosts)
      .values({
        network: "facebook",
        groupId: (g as { id: number }).id,
        ref,
        url: `https://www.facebook.com/groups/g${ref}/posts/${ref}/`,
        author,
        posted: "1 day ago",
        text,
        raw: {
          post: { author, text, links, reactions: "5", comments: "2", shares: null },
          comments: [],
        },
        readAt: new Date(),
      });
  }
  const person = async (companyId: number, first: string, last: string) => {
    await db()
      .insert(people)
      .values({
        companyId,
        fullName: `${first} ${last}`,
        firstName: first,
        lastName: last,
        isCompliance: false,
        origin: "website",
        originRef: "https://x.example/team",
        raw: {},
      });
  };

  it("maps by link, then author, then name; leaves the rest, and tries them again when firms arrive", async () => {
    const acme = await makeCompany(db(), {
      key: "k1",
      domain: "acme.example",
      name: "Acme Staffing",
      niche: "n",
    });
    const bolt = await makeCompany(db(), {
      key: "k2",
      domain: "bolt.example",
      name: "Bolt Talent Partners",
      niche: "n",
    });
    await makeCompany(db(), {
      key: "k3",
      domain: "cove1.example",
      name: "Cove Search",
      niche: "n",
    });
    await makeCompany(db(), {
      key: "k4",
      domain: "cove2.example",
      name: "cove  search",
      niche: "n",
    });
    const outside = await makeCompany(db(), {
      key: "k5",
      domain: "dune.example",
      name: "Dune Hiring",
      niche: "other",
    });
    await person(bolt.id, "Rita", "Marsh");
    await person(bolt.id, "Sam", "Twin");
    await person(acme.id, "Sam", "Twin");

    await readPost(
      "200001",
      "Nobody Known",
      "Need help, see https://www.acme.example/jobs",
      "https://l.facebook.com/l.php?u=https%3A%2F%2Flp.acme.example%2Fx%3Futm%3D1 https://facebook.com/groups/x",
    );
    await readPost("200002", "rita  MARSH", "How do you price a search?", null);
    await readPost(
      "200003",
      "Nobody Known",
      "We just left Bolt Talent Partners, any advice?",
      null,
    );
    // Not one firm: "Cove Search" is two firms' name; "Sam Twin" is two people; Dune is another niche.
    await readPost("200004", "Nobody Known", "Cove Search is hiring", null);
    await readPost("200005", "Sam Twin", "plain post", null);
    await readPost("200006", "Nobody Known", "Dune Hiring is great", null);
    // Never read: nothing to map.
    await db()
      .insert(socialPosts)
      .values({
        network: "facebook",
        groupId: (await db().select().from(socialGroups))[0]?.id as number,
        ref: "200007",
        url: "u",
        raw: {},
      });

    expect(await mapPosts(db(), "n", new Date())).toEqual({ seen: 6, mapped: 3 });
    const posts = await db().select().from(socialPosts).orderBy(socialPosts.ref);
    expect(posts.map((p) => [p.ref, p.mappedBy, p.companyId])).toEqual([
      ["200001", "link", acme.id],
      ["200002", "author", bolt.id],
      ["200003", "name", bolt.id],
      ["200004", null, null],
      ["200005", null, null],
      ["200006", null, null],
      ["200007", null, null],
    ]);
    expect(posts[1]?.personId).not.toBeNull();
    expect(posts[0]?.personId).toBeNull();

    const found = await db().select().from(findings).orderBy(findings.factKey);
    expect(found.map((f) => [f.factKey, f.kind, f.via, f.companyId, f.personId])).toEqual([
      ["fbgroup:post:200001", "post", "facebook-group", acme.id, null],
      ["fbgroup:post:200002", "post", "facebook-group", bolt.id, null],
      ["fbgroup:post:200003", "post", "facebook-group", bolt.id, null],
    ]);
    expect(found[0]?.sourceUrl).toBe("https://www.facebook.com/groups/g200001/posts/200001/");
    expect(found[1]?.value).toMatchObject({
      group: { name: "Group", url: "https://www.facebook.com/groups/g200002/" },
      author: "rita  MARSH",
      text: "How do you price a search?",
      posted: "1 day ago",
      counts: { reactions: "5", comments: "2", shares: null },
      mappedBy: "author",
    });
    // postFacts' hook reads `published_at`; a group post carries none.
    expect(found[0]?.value).not.toHaveProperty("published_at");

    // A second pass changes nothing; a firm that arrives picks up an old post.
    expect(await mapPosts(db(), "n", new Date())).toEqual({ seen: 3, mapped: 0 });
    await db()
      .update(companies)
      .set({ name: "Cove Search Group" })
      .where(eq(companies.domain, "cove1.example"));
    expect(await mapPosts(db(), "n", new Date())).toEqual({ seen: 3, mapped: 1 });
    expect(outside.id).toBeGreaterThan(0);
  });

  it("leaves a post older than 90 days alone", async () => {
    await makeCompany(db(), {
      key: "k1",
      domain: "acme.example",
      name: "Acme Staffing",
      niche: "n",
    });
    await readPost("300001", null, "Acme Staffing rocks", null);
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await mapPosts(db(), "n", later)).toEqual({ seen: 0, mapped: 0 });
  });
});
