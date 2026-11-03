import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { landedAt, landedFrom, PLAIN_NOTES, plainNote } from "./placement-scheduler.js";

const SEED = "seed@example.com";

/** A seed's Gmail: the list answers `found`, the message answers `labelIds` and the auth header. */
function gmail(found: { id: string }[] | undefined, labelIds?: string[], authHeader?: string) {
  const calls: { path: string; input: unknown; account: unknown }[] = [];
  const sites: SiteClient = {
    async call(_site, _method, path, input, account) {
      calls.push({ path, input, account });
      const headers = authHeader ? [{ name: "Authentication-Results", value: authHeader }] : [];
      return (
        path.endsWith("/messages") ? { messages: found } : { labelIds, payload: { headers } }
      ) as never;
    },
    via: async () => "api",
  };
  return { sites, calls };
}

describe("landedFrom", () => {
  it("spam outranks promotions, promotions outrank the inbox", () => {
    expect(landedFrom(["INBOX", "SPAM", "CATEGORY_PROMOTIONS"])).toBe("spam");
    expect(landedFrom(["INBOX", "CATEGORY_PROMOTIONS"])).toBe("promotions");
    expect(landedFrom(["INBOX", "CATEGORY_PERSONAL", "UNREAD"])).toBe("inbox");
    expect(landedFrom(["TRASH"])).toBe("inbox");
  });
});

describe("landedAt", () => {
  it("searches spam and trash by Message-ID, then reads the found id's labels and auth", async () => {
    const header =
      "mx.google.com; dkim=pass header.i=@x.com; spf=pass smtp.mailfrom=a@x.com; dmarc=fail (p=NONE)";
    const { sites, calls } = gmail([{ id: "18f/a" }], ["SPAM"], header);
    expect(await landedAt(sites, SEED, "<abc@example.com>")).toEqual({
      landed: "spam",
      auth: { spf: "pass", dkim: "pass", dmarc: "fail" },
    });
    expect(calls).toEqual([
      {
        path: "/gmail/v1/users/me/messages",
        input: { q: "rfc822msgid:abc@example.com", includeSpamTrash: "true" },
        account: SEED,
      },
      { path: "/gmail/v1/users/me/messages/18f%2Fa", input: { format: "metadata" }, account: SEED },
    ]);
  });

  it("is missing when the seed has no copy, and asks nothing more", async () => {
    const { sites, calls } = gmail(undefined);
    expect(await landedAt(sites, SEED, "<abc@example.com>")).toEqual({
      landed: "missing",
      auth: null,
    });
    expect(calls).toHaveLength(1);
  });
});

describe("plainNote", () => {
  it("turns through the notes one a day, the same for every inbox", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-07"].map(plainNote);
    expect(new Set(days.map((d) => d.subject)).size).toBe(3);
    expect(plainNote("2026-10-05")).toEqual(days[0]);
    const later = new Date(Date.parse("2026-10-05") + PLAIN_NOTES.length * 86_400_000);
    expect(plainNote(later.toISOString().slice(0, 10))).toEqual(days[0]);
  });

  it("no note carries a link", () => {
    for (const n of PLAIN_NOTES) expect(n.body).not.toMatch(/https?:|www\./);
  });
});
