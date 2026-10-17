import { describe, expect, it } from "vitest";
import { SiteCallError } from "./content/autobrowse.js";
import { isRefusal } from "./content/restate.js";
import { sendOnce } from "./maybe-sent.js";
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
const unknown = () => unknownSend("the list lags", AT);
const sendOf = (fn: () => Promise<unknown>) => ({ key: KEY, send: fn });

describe("sendOnce", () => {
  it("runs the send under its key, once", async () => {
    const seenKeys: (string | null)[] = [];
    const r = await sendOnce({
      key: KEY,
      send: async () => {
        seenKeys.push(currentSendKey());
        return "t1_new";
      },
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

  it("unknown: unsure, never a second send", async () => {
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
});
