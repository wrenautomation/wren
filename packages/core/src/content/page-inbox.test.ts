import { describe, expect, it } from "vitest";
import { pageInboxOf, pageInboxQuery, seenPrivateReply } from "./page-inbox.js";

// Synthetic inbox: no real Pages or people.
const SELF = "p1";
const since = "2026-10-16T12:00:00Z";
const msg = (id: string, from: string, text: string, at: string) => ({
  id,
  message: text,
  from: { id: from },
  created_time: at,
});
const conv = (
  them: Record<string, string>,
  messages: ReturnType<typeof msg>[],
  more = false,
): Record<string, unknown> => ({
  participants: { data: [{ id: SELF }, them] },
  updated_time: messages[0]?.created_time,
  messages: { data: messages, ...(more ? { paging: { next: "https://graph.test/m" } } : {}) },
});
const WORDS = "Thanks for the comment, the price list is attached here";

describe("a Page's inbox", () => {
  it("asks Messenger or Instagram for the last messages of each conversation", () => {
    expect(pageInboxQuery("facebook")).toMatchObject({ platform: "messenger", limit: 25 });
    expect(pageInboxQuery("instagram").platform).toBe("instagram");
  });

  it("reads each conversation oldest first, marks ours, says when more exist", () => {
    const inbox = pageInboxOf(
      {
        data: [
          conv(
            { id: "u1", username: "sam_test" },
            [
              msg("m2", SELF, "hello", "2026-10-16T12:01:00+0000"),
              msg("m1", "u1", "hi", "2026-10-16T11:00:00+0000"),
            ],
            true,
          ),
        ],
        paging: { next: "https://graph.test/c" },
      },
      SELF,
    );
    expect(inbox.full).toBe(false);
    expect(inbox.threads[0]).toMatchObject({
      them: { id: "u1", handle: "sam_test", name: "sam_test" },
      more: true,
    });
    expect(inbox.threads[0]?.messages.map((m) => [m.id, m.mine])).toEqual([
      ["m1", false],
      ["m2", true],
    ]);
  });
});

describe("our private reply in it", () => {
  const q = { to: "Sam Test", text: WORDS, since };
  const read = (convs: Record<string, unknown>[], full = true) =>
    pageInboxOf({ data: convs, ...(full ? {} : { paging: { next: "n" } }) }, SELF);

  it("found: our words since the send began, matched by name or handle", () => {
    const inbox = read([
      conv({ id: "u1", name: "Sam Test" }, [msg("m3", SELF, WORDS, "2026-10-16T12:00:09+0000")]),
    ]);
    expect(seenPrivateReply(inbox, q)).toEqual({
      kind: "found",
      ref: "m3",
      at: "2026-10-16T12:00:09+0000",
      url: null,
    });
  });

  it("the same words sent them a day before are another send: absent", () => {
    const inbox = read([
      conv({ id: "u1", name: "Sam Test" }, [msg("m0", SELF, WORDS, "2026-10-15T12:00:00+0000")]),
    ]);
    expect(seenPrivateReply(inbox, q)).toEqual({ kind: "absent" });
  });

  it("unclear: their conversation is cut and does not reach back", () => {
    const inbox = read([
      conv(
        { id: "u1", name: "Sam Test" },
        [msg("m5", "u1", "ok", "2026-10-16T12:30:00+0000")],
        true,
      ),
    ]);
    expect(seenPrivateReply(inbox, q).kind).toBe("unclear");
  });

  it("no conversation with them: absent when the read passes the send, else unclear", () => {
    const old = conv({ id: "u2", name: "Kim Test" }, [
      msg("m6", "u2", "a", "2026-10-10T00:00:00+0000"),
    ]);
    const fresh = conv({ id: "u2", name: "Kim Test" }, [
      msg("m7", "u2", "b", "2026-10-16T13:00:00+0000"),
    ]);
    expect(seenPrivateReply(read([old], false), q)).toEqual({ kind: "absent" });
    expect(seenPrivateReply(read([fresh], false), q).kind).toBe("unclear");
    expect(seenPrivateReply(read([fresh], true), q)).toEqual({ kind: "absent" });
  });
});
