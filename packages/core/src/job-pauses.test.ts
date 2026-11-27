import { describe, expect, it } from "vitest";
import { kindHold } from "./checks.js";
import { callPauseJobs, durationMs } from "./job-pauses.js";

describe("durationMs", () => {
  it("reads minutes, hours and days", () => {
    expect(["30m", "2h", "1d"].map(durationMs)).toEqual([1_800_000, 7_200_000, 86_400_000]);
  });
  it("refuses anything else", () => {
    expect(() => durationMs("2 weeks")).toThrow(/30m, 2h or 1d/);
  });
});

describe("kindHold", () => {
  it("maps a unit to the hold that covers its kind", () => {
    expect(kindHold("replies acct-1")).toBe("replies *");
    expect(kindHold("posts linkedin")).toBe("posts *");
  });
});

describe("callPauseJobs", () => {
  const body = (v: unknown) => Buffer.from(JSON.stringify(v));
  it("names the service, handler, site, account and caller", () => {
    expect(
      callPauseJobs(
        "desk",
        "call",
        body({ site: "linkedin", account: "linkedin@wren", caller: "wren:own-check" }),
      ),
    ).toEqual([
      "desk",
      "desk/call",
      "desk:linkedin",
      "desk:linkedin/linkedin@wren",
      "caller:wren:own-check",
    ]);
  });
  it("names a schedule's job", () => {
    expect(callPauseJobs("CommandRun", "run", body({ job: "capture" }))).toEqual([
      "CommandRun",
      "CommandRun/run",
      "capture",
    ]);
  });
  it("keeps the service names when the body is not JSON", () => {
    expect(callPauseJobs("studio", "cut", Buffer.from("\u0000"))).toEqual(["studio", "studio/cut"]);
  });
});
