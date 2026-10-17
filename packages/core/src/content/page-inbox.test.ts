import { describe, expect, it } from "vitest";
import { pageInboxOf, pageInboxQuery } from "./page-inbox.js";

// Synthetic inbox: no real Pages or people.
const SELF = "p1";
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
