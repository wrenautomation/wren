import { describe, expect, it } from "vitest";
import { wholeHref } from "../explorer/href.js";
import { movedRun } from "./moved-run.js";

const moved = (q: string) => movedRun(new URLSearchParams(q));

describe("an old Runs address (WA-1373)", () => {
  it("opens one run whole in Explorer, with its tab and open item", () => {
    expect(moved("run=r1&tab=talk&open=f2")).toBe(
      wholeHref("weaver/r1", { tab: "talk", open: "f2" }),
    );
  });

  it("puts several runs, or all, on Weaver's whole graph", () => {
    expect(moved("run=r1,r2")).toBe(wholeHref("weaver", { run: "r1,r2" }));
    expect(moved("run=all")).toBe(wholeHref("weaver", { run: "all" }));
  });

  it("sends History to Explorer's Weaver root", () => {
    expect(moved("view=history")).toBe("/explorer/weaver");
  });

  it("keeps Live in place", () => {
    expect(moved("")).toBeNull();
    expect(moved("setup=weaver")).toBeNull();
  });
});
