import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { SiteCallError } from "./content/autobrowse.js";
import { type Seen, sameWords, seenIn, sendFate, sendOnce } from "./maybe-sent.js";

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
