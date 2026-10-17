import { describe, expect, it } from "vitest";
import { SiteCallError } from "./content/autobrowse.js";
import { fakeContentChannel, type PublishedRow, previewOf } from "./content/index.js";
import { isRefusal } from "./content/restate.js";
import {
  findPost,
  POST_LOOK_ROWS,
  type Seen,
  sameWords,
  seenIn,
  seenInMessages,
  seenPost,
  sendOnce,
} from "./maybe-sent.js";
import {
  currentSendKey,
  delivered,
  NotSent,
  rechecking,
  SentFound,
  unknownSend,
} from "./send-verdict.js";

const KEY = "comment:7 k1";
const AT = "2026-10-16T12:00:00.000Z";
const found: Seen = { kind: "found", ref: "t1_ours", at: AT, url: null };
const noSettle = async () => {};
const unknown = () => unknownSend("the list lags", AT);
const sendOf = (fn: () => Promise<unknown>) => ({ key: KEY, send: fn, settle: noSettle });

describe("sendOnce", () => {
  it("runs the send under its key, once", async () => {
    const seenKeys: (string | null)[] = [];
    const r = await sendOnce({
      key: KEY,
      send: async () => {
        seenKeys.push(currentSendKey());
        return "t1_new";
      },
      settle: noSettle,
    });
    expect(r).toEqual({ kind: "sent", sent: "t1_new" });
    expect(seenKeys).toEqual([KEY]);
  });

  it("a verify read that found it is found, with its id, and no second send", async () => {
    let sends = 0;
    const r = await sendOnce(
      sendOf(async () => {
        sends++;
        throw new SentFound("t1_ours", "https://site.test/t1_ours", AT);
      }),
    );
    expect(r).toEqual({
      kind: "found",
      seen: { kind: "found", ref: "t1_ours", at: AT, url: "https://site.test/t1_ours" },
    });
    expect(sends).toBe(1);
  });

  it("not sent before submit, or provably absent: the item may go again", async () => {
    for (const how of ["before_submit", "verified_absent"] as const) {
      const r = await sendOnce(
        sendOf(async () => {
          throw new NotSent(how, "the profile was busy");
        }),
      );
      expect(r).toEqual({ kind: "not_sent", how, reason: "the profile was busy" });
    }
  });

  it("a platform refusal throws as a refusal with its status", async () => {
    const err = await sendOnce(
      sendOf(async () => {
        throw new NotSent("refused", "RATELIMIT", 422);
      }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SiteCallError);
    expect(err.status).toBe(422);
    expect(isRefusal(err)).toBe(true);
  });

  it("unknown with no read: unsure, never a second send", async () => {
    let sends = 0;
    const r = await sendOnce(
      sendOf(async () => {
        sends++;
        throw unknown();
      }),
    );
    expect(r).toEqual({ kind: "unsure", why: "the list lags" });
    expect(sends).toBe(1);
  });

  it("an error after a write answered is unsure, not thrown", async () => {
    const r = await sendOnce(
      sendOf(async () => {
        delivered({ kind: "sent", out: 1 });
        throw new Error("the database dropped");
      }),
    );
    expect(r.kind).toBe("unsure");
    expect(r.kind === "unsure" && r.why).toContain("the database dropped");
  });

  it("an error with no write throws as it came", async () => {
    const boom = new Error("no account");
    await expect(
      sendOnce(
        sendOf(async () => {
          throw boom;
        }),
      ),
    ).rejects.toBe(boom);
  });

  it("a take-over rechecks an unknown answer under the same key", async () => {
    const calls: { key: string | null; recheck: boolean }[] = [];
    await sendOnce({
      key: KEY,
      tried: true,
      send: async () => {
        calls.push({ key: currentSendKey(), recheck: rechecking() });
        return "x";
      },
      settle: noSettle,
    });
    expect(calls).toEqual([{ key: KEY, recheck: true }]);
  });

  it("guards run before a first send, not on a take-over", async () => {
    let guards = 0;
    const before = async () => {
      guards++;
    };
    await sendOnce({ ...sendOf(async () => 1), before });
    await sendOnce({ ...sendOf(async () => 1), before, tried: true });
    expect(guards).toBe(1);
  });

  describe("a site autobrowse does not serve (it keeps a look)", () => {
    it("unknown, our words found: found", async () => {
      const settled: number[] = [];
      const r = await sendOnce({
        key: KEY,
        send: async () => {
          throw unknown();
        },
        look: async () => found,
        settle: async (ms) => {
          settled.push(ms);
        },
        settleMs: 5,
      });
      expect(r).toEqual({ kind: "found", seen: found });
      expect(settled).toEqual([5]);
    });

    it("unknown, absent or unclear: unsure for a person, never a second send", async () => {
      for (const look of [
        async (): Promise<Seen> => ({ kind: "absent" }),
        async (): Promise<Seen> => ({ kind: "unclear", why: "no read" }),
        async (): Promise<Seen> => {
          throw new Error("read failed");
        },
      ]) {
        let sends = 0;
        const r = await sendOnce({
          key: KEY,
          send: async () => {
            sends++;
            throw unknown();
          },
          look,
          settle: noSettle,
        });
        expect(r.kind).toBe("unsure");
        expect(sends).toBe(1);
      }
    });

    it("a plain failure with no write: the read decides", async () => {
      const lost = new SiteCallError("x", "POST", "/p", 502, "bad gateway");
      const send = async () => {
        throw lost;
      };
      expect(await sendOnce({ key: KEY, send, look: async () => found, settle: noSettle })).toEqual(
        { kind: "found", seen: found },
      );
      const unclear = await sendOnce({
        key: KEY,
        send,
        look: async () => ({ kind: "unclear", why: "no read" }),
        settle: noSettle,
      });
      expect(unclear.kind).toBe("unsure");
      // Provably absent: the failure stands as it came.
      await expect(
        sendOnce({ key: KEY, send, look: async () => ({ kind: "absent" }), settle: noSettle }),
      ).rejects.toBe(lost);
    });

    it("the platform's own no is thrown unlooked", async () => {
      let looks = 0;
      const no = new SiteCallError("reddit", "POST", "/api/comment", 403, "banned");
      await expect(
        sendOnce({
          key: KEY,
          send: () => Promise.reject(no),
          look: async () => {
            looks++;
            return found;
          },
          settle: noSettle,
        }),
      ).rejects.toBe(no);
      expect(looks).toBe(0);
    });

    it("a take-over reads first: our words there send nothing; a blind read sends nothing", async () => {
      let sends = 0;
      const send = async () => {
        sends++;
        return "x";
      };
      const there = await sendOnce({
        key: KEY,
        send,
        look: async () => found,
        tried: true,
        settle: noSettle,
      });
      expect(there.kind).toBe("found");
      const blind = await sendOnce({
        key: KEY,
        send,
        look: async () => ({ kind: "unclear", why: "no read" }),
        tried: true,
        settle: noSettle,
      });
      expect(blind.kind).toBe("unsure");
      expect(sends).toBe(0);
    });

    it("send again reads first: found sends nothing; a blind read does not stop a person", async () => {
      let sends = 0;
      const send = async () => {
        sends++;
        return "x";
      };
      const there = await sendOnce({
        key: KEY,
        send,
        look: async () => found,
        again: true,
        settle: noSettle,
      });
      expect(there.kind).toBe("found");
      expect(sends).toBe(0);
      for (const look of [
        async (): Promise<Seen> => ({ kind: "unclear", why: "no read" }),
        async (): Promise<Seen> => ({ kind: "absent" }),
      ]) {
        const again = await sendOnce({ key: KEY, send, look, again: true, settle: noSettle });
        expect(again).toEqual({ kind: "sent", sent: "x" });
      }
      expect(sends).toBe(2);
    });
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
    const long = "A post about the spend gate that runs well past the cut a listing makes. ".repeat(
      3,
    );
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
    const words = [
      "Cold traffic to warm traffic\n\nhttps://go.test/tt",
      "Cold traffic to warm traffic",
    ];
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
    expect(seenPost([older], { words: ["ours"], since, late: "it lists new videos late" })).toEqual(
      { kind: "unclear", why: "it lists new videos late" },
    );
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
