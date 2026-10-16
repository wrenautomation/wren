import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { SiteCallError } from "./content/autobrowse.js";
import { fakeContentChannel, type PublishedRow, previewOf } from "./content/index.js";
import {
  findPost,
  POST_LOOK_ROWS,
  type Seen,
  sameWords,
  seenIn,
  seenInMessages,
  seenPost,
  sendFate,
  sendOnce,
} from "./maybe-sent.js";

const WENT =
  'reddit POST /api/comment failed after spending a read: reddit@alt: "save the comment" already went through on an earlier try of this step; check it before running again';
const maybe = () => new SiteCallError("reddit", "POST", "/api/comment", 502, WENT);
const found: Seen = { kind: "found", ref: "t1_ours", at: "2026-10-16T12:00:00Z", url: null };
const noSettle = async () => {};

describe("sendFate", () => {
  it("reads autobrowse's words before the status", () => {
    expect(sendFate(maybe())).toBe("maybe");
    expect(sendFate(new SiteCallError("x", "POST", "/p", 500, "boom; may have gone through"))).toBe(
      "maybe",
    );
    expect(sendFate(new SiteCallError("x", "POST", "/p", 422, "RATELIMIT"))).toBe("refused");
    expect(sendFate(new SiteCallError("x", "POST", "/p", 429, "slow down"))).toBe("refused");
    expect(sendFate(new SiteCallError("x", "POST", "/p", 408, "timeout"))).toBe("maybe");
    expect(sendFate(new SiteCallError("x", "POST", "/p", 502, "not sent: no session"))).toBe(
      "not_sent",
    );
    expect(sendFate(new restate.TerminalError(`x: ${WENT}`, { errorCode: 502 }))).toBe("maybe");
    expect(sendFate(new restate.TerminalError("no account", { errorCode: 409 }))).toBe("refused");
    expect(sendFate(new Error("reddit: not a username: x"))).toBe("not_sent");
  });
});

describe("sendOnce", () => {
  it("unknown outcome, our words found: recorded once, no second send", async () => {
    let sends = 0;
    const r = await sendOnce({
      send: async () => {
        sends++;
        throw maybe();
      },
      look: async () => found,
      settle: noSettle,
    });
    expect(r).toEqual({ kind: "found", seen: found });
    expect(sends).toBe(1);
  });

  it("unknown outcome, provably absent: one more send", async () => {
    let sends = 0;
    const settled: number[] = [];
    const r = await sendOnce({
      send: async () => {
        sends++;
        if (sends === 1) throw maybe();
        return "t1_second";
      },
      look: async () => ({ kind: "absent" }),
      settle: async (ms) => {
        settled.push(ms);
      },
      settleMs: 5,
    });
    expect(r).toEqual({ kind: "sent", sent: "t1_second" });
    expect(sends).toBe(2);
    expect(settled).toEqual([5]);
  });

  it("absent twice: unsure after the second, never a third", async () => {
    let sends = 0;
    const r = await sendOnce({
      send: async () => {
        sends++;
        throw maybe();
      },
      look: async () => ({ kind: "absent" }),
      settle: noSettle,
    });
    expect(r.kind).toBe("unsure");
    expect(sends).toBe(2);
  });

  it("unreadable: unsure, no second send", async () => {
    let sends = 0;
    for (const look of [
      async (): Promise<Seen> => ({ kind: "unclear", why: "no read" }),
      async (): Promise<Seen> => {
        throw new Error("read failed");
      },
      undefined,
    ]) {
      const r = await sendOnce({
        send: async () => {
          sends++;
          throw maybe();
        },
        look,
        settle: noSettle,
      });
      expect(r.kind).toBe("unsure");
    }
    expect(sends).toBe(3);
  });

  it("looks first: our words already there send nothing", async () => {
    let sends = 0;
    const r = await sendOnce({
      send: async () => {
        sends++;
        return "x";
      },
      look: async () => found,
      first: true,
      settle: noSettle,
    });
    expect(r.kind).toBe("found");
    expect(sends).toBe(0);
  });

  it("an earlier try and a blind first look: unsure, nothing sent", async () => {
    let sends = 0;
    const r = await sendOnce({
      send: async () => {
        sends++;
        return "x";
      },
      look: async () => ({ kind: "unclear", why: "no read" }),
      tried: true,
      settle: noSettle,
    });
    expect(r.kind).toBe("unsure");
    expect(sends).toBe(0);
  });

  it("a refusal or a never-sent failure throws as it came, unlooked", async () => {
    let looks = 0;
    const look = async (): Promise<Seen> => {
      looks++;
      return found;
    };
    const refused = new SiteCallError("reddit", "POST", "/api/comment", 403, "banned");
    await expect(
      sendOnce({ send: () => Promise.reject(refused), look, settle: noSettle }),
    ).rejects.toBe(refused);
    expect(looks).toBe(0);
  });
});

describe("sameWords", () => {
  it("matches a site's echo of our words", () => {
    expect(sameWords("Tom &amp; Jerry\n\nfine", "Tom & Jerry fine")).toBe(true);
    expect(sameWords("a \\_b\\_ c", "a _b_ c")).toBe(true);
    const long = "This is a longer reply that a preview may cut short, well past forty chars.";
    expect(sameWords(long.slice(0, 50), long)).toBe(true);
    expect(sameWords("Thanks!", "Thanks! Here is more.")).toBe(false);
    expect(sameWords("something else", "our words")).toBe(false);
  });

  it("reads a listing's preview, cut with an ellipsis, as our words", () => {
    const long = "A post about the spend gate that runs well past the cut a listing makes. ".repeat(3);
    expect(sameWords(previewOf(long), long)).toBe(true);
    expect(sameWords("wait for it...", "wait for it...")).toBe(true);
  });
});

describe("seenPost", () => {
  const since = "2026-10-16T12:00:00.000Z";
  const row = (id: string, at: string, text: string): PublishedRow => ({
    id,
    url: `https://site.test/${id}`,
    publishedAt: at,
    fetchedWith: "api",
    preview: previewOf(text),
  });
  const older = row("v0", "2026-10-15T09:00:00.000Z", "an older post");
  it("finds our post since the send by its words, or its title, or the draft's own text", () => {
    const ours = row("v1", "2026-10-16T12:00:40.000Z", "Cold traffic to warm traffic");
    // The text as sent carries the funnel link; the site shows the draft's words.
    const words = ["Cold traffic to warm traffic\n\nhttps://go.test/tt", "Cold traffic to warm traffic"];
    expect(seenPost([ours, older], { words, since })).toEqual({
      kind: "found",
      ref: "v1",
      at: "2026-10-16T12:00:40.000Z",
      url: "https://site.test/v1",
    });
    expect(seenPost([ours], { words: [null, "Cold traffic to warm traffic"], since }).kind).toBe(
      "found",
    );
  });

  it("the same words posted before the send are not this post", () => {
    const before = row("v9", "2026-10-15T12:00:00.000Z", "the same words");
    expect(seenPost([before], { words: ["the same words"], since }).kind).toBe("absent");
  });

  it("absent only when the listing reaches back past the send", () => {
    const other = row("v2", "2026-10-16T11:59:00.000Z", "another post");
    expect(seenPost([other], { words: ["ours"], since })).toMatchObject({ kind: "unclear" });
    expect(seenPost([other, older], { words: ["ours"], since })).toEqual({ kind: "absent" });
    expect(seenPost([], { words: ["ours"], since }).kind).toBe("unclear");
  });

  it("a site that lists a fresh post late never proves it absent", () => {
    expect(
      seenPost([older], { words: ["ours"], since, late: "it lists new videos late" }),
    ).toEqual({ kind: "unclear", why: "it lists new videos late" });
  });

  it("no words to look for is unclear", () => {
    expect(seenPost([older], { words: [null, " "], since }).kind).toBe("unclear");
  });
});

describe("findPost", () => {
  const since = "2026-10-16T12:00:00.000Z";
  it("reads one short page of the channel's own posts", async () => {
    const ch = fakeContentChannel("x", { now: () => new Date("2026-10-16T12:01:00.000Z") });
    await ch.publish({ text: "our post, read back after a lost answer" });
    const asked: unknown[] = [];
    const list = ch.list.bind(ch);
    const seen = await findPost(
      {
        list: (q) => {
          asked.push(q);
          return list(q);
        },
      },
      { words: ["our post, read back after a lost answer"], since },
    );
    expect(seen.kind).toBe("found");
    expect(asked).toEqual([{ limit: POST_LOOK_ROWS }]);
  });

  it("a failed read, or a channel that lists late, is unclear", async () => {
    const failing = { list: async () => Promise.reject(new Error("no token")) };
    expect(await findPost(failing, { words: ["ours"], since })).toMatchObject({
      kind: "unclear",
      why: expect.stringContaining("no token"),
    });
    const late = {
      list: async () => [
        {
          id: "old",
          url: "",
          publishedAt: "2026-10-01T00:00:00.000Z",
          fetchedWith: "api" as const,
          preview: "old",
        },
      ],
      listsLate: (m: "image" | "video" | null) => (m === "video" ? "late for video" : null),
    };
    expect(await findPost(late, { words: ["ours"], since, media: "video" })).toMatchObject({
      kind: "unclear",
      why: "late for video",
    });
    expect(await findPost(late, { words: ["ours"], since, media: "image" })).toEqual({
      kind: "absent",
    });
  });
});

describe("seenIn", () => {
  const at = (i: { at: string }) => i.at;
  const f = (i: { ref: string }) => ({ kind: "found" as const, ref: i.ref, at: null, url: null });
  const since = "2026-10-16T12:00:00Z";
  it("absent only when the listing reaches back past the send", () => {
    const old = [{ ref: "a", at: "2026-10-16T11:00:00Z", text: "x" }];
    const recent = [{ ref: "b", at: "2026-10-16T11:58:00Z", text: "x" }];
    const match = (i: { text: string }) => i.text === "ours";
    expect(seenIn(old, { since, full: false, match, at, found: f }).kind).toBe("absent");
    expect(seenIn(recent, { since, full: false, match, at, found: f }).kind).toBe("unclear");
    expect(seenIn(recent, { since, full: true, match, at, found: f }).kind).toBe("absent");
    expect(
      seenIn([{ ref: "c", at: since, text: "ours" }], { since, full: false, match, at, found: f }),
    ).toMatchObject({ kind: "found", ref: "c" });
  });
});

describe("seenInMessages", () => {
  const since = "2026-10-16T12:00:00Z";
  const theirs = {
    id: "m1",
    text: "Can you send the link?",
    at: "2026-10-16T11:00:00Z",
    mine: false,
  };
  const ours = {
    id: "m2",
    text: "Here it is: example.com",
    at: "2026-10-16T12:00:05Z",
    mine: true,
  };
  const text = "Here it is: example.com";
  it("finds our words, never theirs", () => {
    expect(seenInMessages([theirs, ours], { text, since })).toMatchObject({
      kind: "found",
      ref: "m2",
      at: ours.at,
    });
    expect(seenInMessages([theirs, { ...ours, mine: false }], { text, since }).kind).not.toBe(
      "found",
    );
  });
  it("absent when the read reaches back past the send; unclear when it doesn't", () => {
    expect(seenInMessages([theirs], { text, since }).kind).toBe("absent");
    const fresh = { ...theirs, at: "2026-10-16T11:59:00Z" };
    expect(seenInMessages([fresh], { text, since }).kind).toBe("unclear");
  });
  it("no conversation in the read: unclear", () => {
    expect(seenInMessages(null, { text, since }).kind).toBe("unclear");
  });
});
