import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftTurns } from "./draft.js";

describe("DraftTurns", () => {
  it("breaks an unbroken name or error, so a turn never widens the page", () => {
    const html = renderToStaticMarkup(
      <DraftTurns
        turns={[
          {
            id: "t1",
            at: "2026-10-16T12:00:00Z",
            command: "draft-ask",
            by: "averyverylongmailbox@subdomain.example.com",
            state: "failed",
            error: "https://example.com/a/very/long/path/that/never/stops",
          } as never,
        ]}
      />,
    );
    expect(html).toMatch(
      /class="\[overflow-wrap:anywhere\][^"]*">averyverylongmailbox@subdomain.example.com asked/,
    );
    expect(html).toMatch(/class="\[overflow-wrap:anywhere\] text-\(--ui-bad\)">https:/);
  });
});
