/** A line of copy fills its email's slot, its fields as «placeholders». */
import { describe, expect, it } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { kindOf } = await import("./experiments.js");

describe("kindOf", () => {
  it("puts the words in the slot, fields as placeholders", () => {
    const kind = kindOf({ subject: "Hi «first_name»", body: "S. Thanks.", slot: "S" });
    expect(kind?.kind === "email" && kind.fill?.(" I saw {company_name|your firm} grew ")).toEqual({
      subject: "Hi «first_name»",
      body: "I saw «company_name» grew. Thanks.",
    });
    expect(kindOf(null)).toBeNull();
  });
});
