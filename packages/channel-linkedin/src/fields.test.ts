import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { linkedinContent } from "./content.js";

describe("linkedin post fields", () => {
  it("sends who sees it and reshares off", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const sites: SiteClient = {
      call: async (_s, _m, path, input) => {
        calls.push([path, input]);
        return (path === "/v2/userinfo" ? { sub: "abc" } : { id: "urn:li:share:1" }) as never;
      },
      via: async () => "api",
    };
    await linkedinContent(sites).publish({
      text: "hi",
      extra: { visibility: "CONNECTIONS", noReshare: true },
    });
    expect(calls.find(([p]) => p === "/rest/posts")?.[1]).toMatchObject({
      commentary: "hi",
      visibility: "CONNECTIONS",
      isReshareDisabledByAuthor: true,
    });
  });
});
