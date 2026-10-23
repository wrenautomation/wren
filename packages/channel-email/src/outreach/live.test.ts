import { field, type Template, template, text } from "@wren/core/slots";
import { describe, expect, it } from "vitest";
import { copyGap } from "./live.js";
import { sequence, sequenceStep } from "./sequences.js";

const SEQ = sequence("a-days-0-5", [sequenceStep("a/opener", 0), sequenceStep("followup", 5)]);
const OPENER = template("a/opener", [text("hello")], [text("Hi "), field("first_name")]);
const FOLLOWUP = template("followup", null, [text("Bumping this.")]);
const live = (...t: Template[]) => new Map(t.map((x) => [x.name, x]));

describe("copyGap", () => {
  it("is null when every step is live", () => {
    expect(copyGap(SEQ, live(OPENER, FOLLOWUP))).toBeNull();
  });

  it("names every step with no live template, sorted", () => {
    expect(copyGap(SEQ, live())).toBe("no copy: a/opener, followup not live");
    expect(copyGap(SEQ, live(OPENER))).toBe("no copy: followup not live");
  });

  it("refuses an opener with no subject", () => {
    const riding = template("a/opener", null, [text("Hi")]);
    expect(copyGap(SEQ, live(riding, FOLLOWUP))).toBe("no copy: opener a/opener has no subject");
  });

  it("refuses copy that quotes an offer term the offer does not set", () => {
    const quoting = template("a/opener", [text("hello")], [text("Fee "), field("offer.fee")]);
    expect(copyGap(SEQ, live(quoting, FOLLOWUP))).toBe(
      "no copy: a/opener quotes offer.fee, which the offer does not set",
    );
    expect(copyGap(SEQ, live(quoting, FOLLOWUP), { "offer.fee": "x" })).toBeNull();
  });
});
