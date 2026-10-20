// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Action, runningOn } from "./action.js";
import { Bulk } from "./records.js";
import { fakeWriteEnv } from "./save/test-kit.js";
import { recordKey, Writes } from "./save/writes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APPROVE: Action = { id: "approve", label: "Approve", handler: "drafts/approve", bulk: true };
const ROWS = [{ id: 1 }, { id: 2 }, { id: 3 }];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(picked: string[], running: { action: string; ids: (string | number)[] } | null) {
  act(() =>
    root.render(
      <Bulk
        actions={[APPROVE]}
        rows={ROWS}
        picked={new Set(picked)}
        run={vi.fn()}
        busy={!!running}
        running={running}
        clear={() => undefined}
      />,
    ),
  );
  return host.querySelector("button[aria-busy], button:not([aria-busy])");
}

describe("a press is busy only on the rows it is at work on", () => {
  it("a bulk button for other rows is turned off but draws no bar", () => {
    const b = draw(["2"], { action: "approve", ids: [1] });
    expect(b?.textContent).toContain("Approve");
    expect(b?.hasAttribute("aria-busy")).toBe(false);
    expect(b?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector('[aria-hidden="true"].animate-ui-busy')).toBeNull();
  });

  it("a bulk button for the rows it works on draws its bar", () => {
    const b = draw(["1", "2"], { action: "approve", ids: [1] });
    expect(b?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[aria-hidden="true"].animate-ui-busy')).not.toBeNull();
  });

  it("ids from a stored write come back as text and still match", () => {
    const b = draw(["1"], { action: "approve", ids: ["1"] });
    expect(b?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("a send on one record", () => {
  it("is at work on that record, not on another of the family", async () => {
    const writes = new Writes(fakeWriteEnv());
    void writes
      .press(
        {
          key: "reply:t1:x",
          what: "inbox.reply",
          label: "Reply",
          records: [recordKey("threads", "t1")],
          input: { body: "hello" },
        },
        (requestId) =>
          writes.call("console/call", { body: "hello", requestId }, () => new Promise(() => {})),
      )
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    const going = writes.goingIn("threads");
    expect(going).toEqual({ what: "inbox.reply", ids: ["t1"] });
    const running = going && { action: going.what, ids: going.ids };
    expect(runningOn(running, "inbox.reply", ["t1"])).toBe(true);
    expect(runningOn(running, "inbox.reply", ["t2"])).toBe(false);
    expect(runningOn(running, "inbox.reply", ["t2", "t1"])).toBe(true);
    expect(runningOn(running, "other", ["t1"])).toBe(false);
    expect(runningOn(null, "inbox.reply", ["t1"])).toBe(false);
  });
});
