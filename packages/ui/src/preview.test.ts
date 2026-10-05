import { describe, expect, it } from "vitest";
import { shapeOf } from "./preview.js";

describe("shapeOf", () => {
  it("counts an email's subject, words and reading time", () => {
    const body = Array(476).fill("word").join(" ");
    expect(shapeOf({ kind: "email", subject: "Quick question" }, body)).toEqual([
      "subject 14 characters",
      "476 words",
      "2 min to read",
    ]);
    expect(shapeOf({ kind: "email" }, "Thanks, see you then.")).toEqual(["4 words", "1 s to read"]);
  });
  it("counts a text's characters and the parts the channel bills", () => {
    const parts = (t: string) => ({ parts: t.length > 160 ? 2 : 1, encoding: "GSM-7" });
    expect(shapeOf({ kind: "sms", parts }, "x".repeat(161))).toEqual([
      "161 characters",
      "2 texts (GSM-7)",
    ]);
  });
  it("counts a post's title and characters against its cap", () => {
    const feed = { laptop: 3, phone: 0 };
    expect(
      shapeOf(
        { kind: "post", site: "YouTube", title: "Spend gate", max: 5000, feed },
        "what it does",
      ),
    ).toEqual(["title 10 characters", "12 of 5000 characters", "3 words", "1 s to read"]);
  });
});
