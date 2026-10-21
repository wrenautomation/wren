// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Path, type PathStep } from "./path.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const RUNNING: PathStep[] = [
  { title: "Searching", state: "done", detail: "12 sources", sources: ["reddit", "site"] },
  { title: "Reading", state: "run", detail: "3 of 12 · reddit.com" },
  { title: "Writing", state: "wait" },
];
const DONE: PathStep[] = RUNNING.map((s) => ({ ...s, state: "done" }));
const draw = (steps: PathStep[], summary?: string) =>
  act(() => root.render(<Path title="Research a person" steps={steps} summary={summary} />));

describe("Path", () => {
  it("shows each step with its state, its detail and its sources", () => {
    draw(RUNNING, "Read 12 sources");
    const items = [...host.querySelectorAll("li[data-state]")];
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "run", "wait"]);
    expect(host.textContent).toContain("3 of 12 · reddit.com");
    expect(host.textContent).toContain("reddit");
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
  });

  it("cross-fades a changed detail instead of swapping it at once", () => {
    draw(RUNNING);
    draw(RUNNING.map((s) => (s.state === "run" ? { ...s, detail: "8 of 12 · linkedin.com" } : s)));
    expect(host.textContent).toContain("3 of 12");
    expect(host.querySelector("[data-out]")).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(host.textContent).toContain("8 of 12 · linkedin.com");
    expect(host.querySelector("[data-out]")).toBeNull();
  });

  it("folds to one line when every step is done, and opens again on a click", () => {
    draw(RUNNING, "Read 12 sources · 3.9 s");
    draw(DONE, "Read 12 sources · 3.9 s");
    expect(host.querySelector("ol")).not.toBeNull();
    act(() => vi.advanceTimersByTime(600));
    expect(host.querySelector("ol")).toBeNull();
    const fold = host.querySelector("button");
    expect(fold?.textContent).toBe("Read 12 sources · 3.9 s");
    act(() => fold?.click());
    expect(host.querySelector("ol")).not.toBeNull();
  });

  it("starts folded when it is already whole, and never folds without a summary", () => {
    draw(DONE, "Done");
    expect(host.querySelector("ol")).toBeNull();
    draw(DONE);
    act(() => vi.advanceTimersByTime(1000));
    expect(host.querySelector("ol")).not.toBeNull();
  });
});
