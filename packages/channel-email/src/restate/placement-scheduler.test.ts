import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { landedAt, landedFrom, placementLine } from "./placement-scheduler.js";

const SEED = "seed@example.com";

/** A seed's Gmail: the list answers `found`, the message answers `labelIds`. */
function gmail(found: { id: string }[] | undefined, labelIds?: string[]) {
  const calls: { path: string; input: unknown; account: unknown }[] = [];
  const sites: SiteClient = {
    async call(_site, _method, path, input, account) {
      calls.push({ path, input, account });
      return (path.endsWith("/messages") ? { messages: found } : { labelIds }) as never;
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
  it("searches spam and trash by Message-ID, then reads the found id's labels", async () => {
    const { sites, calls } = gmail([{ id: "18f/a" }], ["SPAM"]);
    expect(await landedAt(sites, SEED, "<abc@example.com>")).toBe("spam");
    expect(calls).toEqual([
      {
        path: "/gmail/v1/users/me/messages",
        input: { q: "rfc822msgid:abc@example.com", includeSpamTrash: "true" },
        account: SEED,
      },
      { path: "/gmail/v1/users/me/messages/18f%2Fa", input: { format: "minimal" }, account: SEED },
    ]);
  });

  it("is missing when the seed has no copy, and asks nothing more", async () => {
    const { sites, calls } = gmail(undefined);
    expect(await landedAt(sites, SEED, "<abc@example.com>")).toBe("missing");
    expect(calls).toHaveLength(1);
  });
});

describe("placementLine", () => {
  const row = (landed: "inbox" | "spam" | null, detail: string | null = null) => ({
    landed,
    detail,
  });

  it("counts landings out of the day's copies", () => {
    expect(placementLine("a@example.com", [row("inbox"), row("inbox")])).toBe(
      "a@example.com: inbox 2/2",
    );
    expect(placementLine("a@example.com", [row("inbox"), row("spam")])).toBe(
      "a@example.com: inbox 1/2, spam 1",
    );
  });

  it("says why a day has no landing", () => {
    expect(placementLine("a@example.com", [row(null, "no draft yet")])).toBe(
      "a@example.com: no draft yet",
    );
    expect(placementLine("a@example.com", [row(null)])).toBe("a@example.com: not checked yet");
    expect(placementLine("a@example.com", [])).toBe("a@example.com: not checked yet");
  });
});
