import type { ContextNode, ThreadContext } from "@wren/outreach";
import type { RecordAct } from "@wren/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThreadView, treeOf } from "./thread-context.js";

// A synthetic thread: our comment, a reply, its author's follow-up, and a third person under it.
const n = (
  ref: string,
  parent: string,
  handle: string,
  at: string,
  more: Partial<ContextNode> = {},
): ContextNode => ({
  ref,
  parent,
  handle,
  text: `${handle} at ${ref}`,
  at,
  url: `https://example.test/c/${ref}`,
  ours: false,
  row: null,
  ...more,
});
const NODES = [
  n("c_ours", "p", "wren_test", "2026-10-01T01:00:00.000Z", { ours: true }),
  n("c_a1", "c_ours", "replier_a", "2026-10-01T02:00:00.000Z", {
    row: { id: 1, state: "answered" },
  }),
  n("c_a2", "c_a1", "replier_a", "2026-10-01T03:00:00.000Z", { row: { id: 2, state: "waiting" } }),
  n("c_b1", "c_a2", "replier_b", "2026-10-01T04:00:00.000Z"),
  n("c_gone", "c_ours", "[deleted]", "2026-10-01T05:00:00.000Z"),
  // Its parent wasn't in the read: it starts a branch of its own.
  n("c_lost", "c_unseen", "replier_c", "2026-10-01T06:00:00.000Z"),
];
const CTX: ThreadContext = {
  platform: "reddit",
  post: {
    title: "A synthetic post",
    text: "Its words",
    url: "https://example.test/p",
    place: "r/test",
    author: "poster",
    media: null,
    at: "2026-10-01T00:00:00.000Z",
  },
  nodes: NODES,
  focus: "c_a2",
  readAt: "2026-10-01T07:00:00.000Z",
  more: 2,
  refresh: true,
};
const act = Object.assign(async () => ({}), { record: "engage:comment:2" }) as RecordAct;

describe("treeOf", () => {
  it("nests replies under their parents, any depth", () => {
    const roots = treeOf(NODES);
    expect(roots.map((t) => t.node.ref)).toEqual(["c_ours", "c_lost"]);
    const ours = roots[0];
    expect(ours?.kids.map((k) => k.node.ref)).toEqual(["c_a1", "c_gone"]);
    expect(ours?.kids[0]?.kids[0]?.node.ref).toBe("c_a2");
    expect(ours?.kids[0]?.kids[0]?.kids[0]?.node.ref).toBe("c_b1");
  });
  it("a node naming itself as parent stays a root", () => {
    expect(treeOf([n("x", "x", "a", "2026-10-01T00:00:00.000Z")]).map((t) => t.node.ref)).toEqual([
      "x",
    ]);
  });
});

describe("ThreadView", () => {
  const html = renderToStaticMarkup(<ThreadView c={CTX} act={act} accounts={null} />);
  const at = (ref: string) => html.indexOf(`data-node="${ref}"`);

  it("draws the post with its link and the replies nested in order", () => {
    expect(html).toContain("A synthetic post");
    expect(html).toContain('href="https://example.test/p"');
    expect(at("c_ours")).toBeLessThan(at("c_a1"));
    expect(at("c_a1")).toBeLessThan(at("c_a2"));
    expect(at("c_a2")).toBeLessThan(at("c_b1"));
    // c_b1 sits inside c_a2's list: three lists deep under ours.
    const nested = html.slice(at("c_ours"), at("c_b1"));
    expect(nested.match(/<ol/g)?.length).toBe(3);
  });

  it("marks the focus and each kept message's state", () => {
    expect(html).toMatch(/data-node="c_a2" data-focus=""/);
    const a1 = html.slice(at("c_a1"), at("c_a2"));
    expect(a1).toContain("Answered");
    const a2 = html.slice(at("c_a2"), at("c_b1"));
    expect(a2).toContain("Waiting");
  });

  it("offers Reply from Wren on theirs only, and Open on site where there's a link", () => {
    const ours = html.slice(at("c_ours"), at("c_a1"));
    expect(ours).not.toContain("Reply from Wren");
    expect(ours).toContain("Open on site");
    const gone = html.slice(at("c_gone"), at("c_lost"));
    expect(gone).toContain("Deleted");
    expect(gone).not.toContain("Reply from Wren");
    expect(html.match(/Reply from Wren/g)?.length).toBe(4);
  });

  it("says what the site held back, and offers Refresh", () => {
    expect(html.replace(/<!-- -->/g, "")).toContain("The site hid 2 more replies");
    expect(html).toContain("Refresh");
  });
});

describe("ThreadView, read only (a client's Inbox)", () => {
  const html = renderToStaticMarkup(<ThreadView c={CTX} act={act} accounts={null} readOnly />);
  it("draws the same nested thread with Open on site", () => {
    expect(html).toContain('data-node="c_b1"');
    expect(html).toContain("Open on site");
  });
  it("offers no Reply from Wren and no Refresh: both run on Wren's own desk", () => {
    const full = renderToStaticMarkup(<ThreadView c={CTX} act={act} accounts={null} />);
    expect(full).toContain("Reply from Wren");
    expect(full).toContain(">Refresh<");
    expect(html).not.toContain("Reply from Wren");
    expect(html).not.toContain(">Refresh<");
  });
});
