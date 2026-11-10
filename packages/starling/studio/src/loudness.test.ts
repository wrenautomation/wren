import { describe, expect, it } from "vitest";
import { levelFilter, levelMiss, measureFilter, parseLoudnorm } from "./loudness.js";

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

  it("levels with one gain and a limiter under the cap, at 192 kHz", () => {
    expect(levelFilter(9.704, -2)).toBe(
      "volume=9.7dB,aresample=192000,alimiter=limit=0.7943:attack=5:release=50:level=false,aresample=48000",
    );
  });

  it("a miss is how far outside: I past 0.5, or a peak over -1.5", () => {
    expect(levelMiss({ i: -14.4, tp: -1.6 }, -14)).toBe(0);
    // WA-1284: what loudnorm's own apply gave
    expect(levelMiss({ i: -16.9, tp: -0.8 }, -14)).toBeCloseTo(2.4 + 0.7);
  });

  it("reads loudnorm's JSON; silence (-inf) or none is null", () => {
    expect(parseLoudnorm(STDERR)).toEqual({ i: -27.52, tp: -9.31, lra: 6.4, thresh: -38.1 });
    expect(parseLoudnorm(STDERR.replace('"-27.52"', '"-inf"'))).toBeNull();
    expect(parseLoudnorm("no json here")).toBeNull();
  });
});
