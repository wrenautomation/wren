/** Variant options read back from a stored template source, for the per-option report. */
import { describe, expect, it } from "vitest";
import { variantTexts } from "./variants.js";

describe("variantTexts", () => {
  it("names each option's words, facts as {name}, and marks the subject's points", () => {
    const { texts, subject } = variantTexts(
      "t",
      "subject: (({first_name}, ))[[about your clients | a thought]]\n\nHi {first_name|there},\n\n[[I follow {company_short|your firm}. | I've followed you.]]\n",
    );
    expect(texts.get("v1")).toEqual(["about your clients", "a thought"]);
    expect(texts.get("v2")).toEqual(["I follow {company_short}.", "I've followed you."]);
    expect([...subject]).toEqual(["v1"]);
  });
});
