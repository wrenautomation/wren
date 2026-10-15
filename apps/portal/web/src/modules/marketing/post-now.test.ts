// A client's Post now on its drafts, end to end on the web side: the page offers lane B's action
// only where the `post_now` flag is on, and the press calls MarketingConsole's approveDraft with
// `now` (its server gate: test/integration/marketing-console.test.ts). Synthetic ids.
import { can } from "@wren/ui";
import { describe, expect, it, vi } from "vitest";

const calls: [string, unknown][] = [];
vi.mock("../../api.js", async (real) => ({
  ...(await real<typeof import("../../api.js")>()),
  call: async (handler: string, body: unknown) => {
    calls.push([handler, body]);
    return { done: ["d1"] };
  },
}));
vi.stubGlobal("location", new URL("http://localhost:8803/"));
const { clientMarketing } = await import("./index.js");
const { callOf } = await import("../../records.js");

const postNow = () => {
  const drafts = clientMarketing.pages.find((p) => p.id === "drafts");
  const a =
    drafts && "actions" in drafts
      ? drafts.actions?.find((x) => x.id === "marketing.postNow")
      : undefined;
  if (!a) throw new Error("no Post now on a client's drafts");
  return a;
};

describe("a client's Post now", () => {
  it("shows only where post_now is on; Wren's team always", () => {
    const a = postNow();
    expect(a).toMatchObject({ handler: "marketing/postNow", requires: { flag: "post_now" } });
    const client = { team: false, demo: false, role: "owner" as const, can: ["act"] };
    expect(can(client, a.requires)).toBe(false);
    expect(can({ ...client, flags: { post_now: "off" } }, a.requires)).toBe(false);
    expect(can({ ...client, flags: { post_now: "on" } }, a.requires)).toBe(true);
    expect(can({ team: true, demo: false }, a.requires)).toBe(true);
  });

  it("calls approveDraft with now, over the words on screen", async () => {
    calls.length = 0;
    await callOf("acme")(postNow().handler, { ids: ["draft:d1"], expect: "h1" });
    expect(calls).toEqual([
      ["marketing/approveDraft", { client: "acme", ids: ["d1"], now: true, expect: "h1" }],
    ]);
  });
});
