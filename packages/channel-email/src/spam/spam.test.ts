import { describe, expect, it } from "vitest";
import { field, template, text, variants } from "@wren/core/slots";
import { coveringRenders } from "./coverage.js";
import { parseReport } from "./spamassassin.js";

const REPORT = `1.4/5.0
Spam detection software, running on the system "abc123",
has NOT identified this incoming email as spam.

Content analysis details:   (1.4 points, 5.0 required)

 pts rule name              description
---- ---------------------- --------------------------------------------------
 1.2 MISSING_HEADERS        Missing To: header
 0.2 TVD_SPACE_RATIO        BODY: Space ratio and runs of spaces
                            in the text
-0.0 NO_RELAYS              Informational: message was not relayed via SMTP
`;

describe("parseReport", () => {
  it("reads the score and every rule, descriptions joined across lines", () => {
    expect(parseReport(REPORT)).toEqual({
      score: 1.4,
      rules: [
        { points: 1.2, name: "MISSING_HEADERS", description: "Missing To: header" },
        {
          points: 0.2,
          name: "TVD_SPACE_RATIO",
          description: "BODY: Space ratio and runs of spaces in the text",
        },
        {
          points: -0,
          name: "NO_RELAYS",
          description: "Informational: message was not relayed via SMTP",
        },
      ],
    });
  });

  it("a clean message has no table", () => {
    expect(parseReport("0.0/5.0\n")).toEqual({ score: 0, rules: [] });
  });

  it("no score is an error, not a pass", () => {
    expect(() => parseReport("spamd down\n")).toThrow(/no score/);
  });
});

describe("coveringRenders", () => {
  const tpl = template(
    "t",
    [variants("greet", ["Hi", "Hey"])],
    [
      text("Dear "),
      field("first_name"),
      text(", "),
      variants("count", ["one", "two", "three", "four"]),
      text(" "),
      variants("letter", ["a", "b"]),
    ],
  );

  it("renders as many emails as the widest point, every option at least once", () => {
    const out = coveringRenders(tpl, { first_name: "Dana" });
    expect(out.map((r) => [r.subject, r.body])).toEqual([
      ["Hi", "Dear Dana, one a"],
      ["Hey", "Dear Dana, two b"],
      ["Hey", "Dear Dana, three b"],
      ["Hey", "Dear Dana, four b"],
    ]);
  });
});
