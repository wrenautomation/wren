import { describe, expect, it } from "vitest";
import { applyFilter, measureFilter, parseLoudnorm } from "./loudness.js";

const STDERR = `[Parsed_loudnorm_0 @ 0x1]
{
	"input_i" : "-27.52",
	"input_tp" : "-9.31",
	"input_lra" : "6.40",
	"input_thresh" : "-38.10",
	"output_i" : "-14.02",
	"output_tp" : "-1.50",
	"output_lra" : "5.10",
	"output_thresh" : "-24.50",
	"normalization_type" : "dynamic",
	"target_offset" : "0.02"
}`;

describe("loudness", () => {
  it("measures at -14 LUFS, true peak -1.5", () => {
    expect(measureFilter()).toBe("loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json");
  });

  it("applies with what pass one measured, linear, and no offset", () => {
    const f = applyFilter({ i: -27.52, tp: -9.31, lra: 6.4, thresh: -38.1 });
    expect(f).toBe(
      "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-27.52:measured_TP=-9.31:measured_LRA=6.4:measured_thresh=-38.1:linear=true:print_format=summary",
    );
    expect(f).not.toContain("offset");
    // The second try aims past -14 by what the first fell short.
    expect(applyFilter({ i: -27.52, tp: -9.31, lra: 6.4, thresh: -38.1 }, -13.084)).toMatch(
      /^loudnorm=I=-13\.08:TP=-1\.5:LRA=11:measured_I=-27\.52/,
    );
  });

  it("reads loudnorm's JSON; silence (-inf) or none is null", () => {
    expect(parseLoudnorm(STDERR)).toEqual({ i: -27.52, tp: -9.31, lra: 6.4, thresh: -38.1 });
    expect(parseLoudnorm(STDERR.replace('"-27.52"', '"-inf"'))).toBeNull();
    expect(parseLoudnorm("no json here")).toBeNull();
  });
});
