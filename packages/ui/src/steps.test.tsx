// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD, type JobStep, Steps } from "./steps.js";

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

const CARDS = [
  { key: "a", label: "example.com", mark: "E" },
  { key: "b", label: "example.org", mark: "O" },
];
const RUNNING: JobStep[] = [
  { title: "Searching", state: "done", detail: "2 sources", cards: CARDS, count: "2 sources" },
  { title: "Reading", state: "run", detail: "example.com · 3 pages" },
  { title: "Writing", state: "wait" },
];
const DONE: JobStep[] = RUNNING.map((s) => ({ ...s, state: "done" }));
const draw = (steps: JobStep[], summary?: string, startedAt?: number) =>
  act(() =>
    root.render(
      <Steps title="Research a person" steps={steps} summary={summary} startedAt={startedAt} />,
    ),
  );
const status = () => host.querySelector("li[data-state=run] .ui-status > :not([data-out])");

describe("Steps", () => {
  it("shows each step with its state, its status line and its cards", () => {
    draw(RUNNING, "Read 2 sources");
    const items = [...host.querySelectorAll("li[data-state]")];
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "run", "wait"]);
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(status()?.textContent).toBe("example.com · 3 pages");
    expect(host.querySelectorAll(".ui-card")).toHaveLength(2);
  });

  it("stacks a done step's cards into a deck with its count", () => {
    draw(RUNNING);
    expect(host.querySelector(".ui-cards")?.hasAttribute("data-stack")).toBe(true);
    expect(host.querySelector(".ui-cards-count")?.textContent).toBe("2 sources");
    const open: JobStep[] = [{ ...RUNNING[0]!, state: "run" }];
    draw(open);
    expect(host.querySelector(".ui-cards")?.hasAttribute("data-stack")).toBe(false);
  });

  it("cross-fades a changed status line, and holds each line so a fast caller never flickers", () => {
    draw(RUNNING);
    const at = (detail: string) =>
      draw(RUNNING.map((s) => (s.state === "run" ? { ...s, detail } : s)));
    at("example.org · 1 page");
    act(() => vi.advanceTimersByTime(0));
    expect(status()?.textContent).toBe("example.org · 1 page");
    expect(host.querySelector("[data-out]")?.textContent).toBe("example.com · 3 pages");
    // Two more lines inside one hold: neither shows until the hold ends, then only the last.
    at("example.net · 2 pages");
    at("example.net · 4 pages");
    act(() => vi.advanceTimersByTime(HOLD - 50));
    expect(status()?.textContent).toBe("example.org · 1 page");
    act(() => vi.advanceTimersByTime(60));
    expect(status()?.textContent).toBe("example.net · 4 pages");
    act(() => vi.advanceTimersByTime(300));
    expect(host.querySelector("[data-out]")).toBeNull();
  });

  it("shows the clock and says the person can leave past ten seconds", () => {
    draw(RUNNING, undefined, Date.now());
    expect(host.textContent).not.toContain("You can leave");
    act(() => vi.advanceTimersByTime(11_000));
    expect(host.textContent).toContain("Still working · 11 s. You can leave.");
  });

  it("folds to one line when every step is done, and opens again on a click", () => {
    draw(RUNNING, "Read 2 sources · 4 s");
    draw(DONE, "Read 2 sources · 4 s");
    expect(host.querySelector("ol")).not.toBeNull();
    act(() => vi.advanceTimersByTime(800));
    expect(host.querySelector("ol")).toBeNull();
    const fold = host.querySelector("button");
    expect(fold?.textContent).toBe("Read 2 sources · 4 s");
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
