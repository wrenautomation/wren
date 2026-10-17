import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Diff } from "./diff.js";

describe("Diff", () => {
  it("lets an unbroken address wrap, so a line never widens the page", () => {
    const html = renderToStaticMarkup(
      <Diff
        a="averyverylongmailbox@example.com"
        b="https://example.com/a/b"
        names={["One", "Two"]}
      />,
    );
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("averyverylongmailbox@example.com");
  });
});
