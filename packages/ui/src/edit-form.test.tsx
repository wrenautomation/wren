// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { centsOf, changedFrom, type EditForm, TextField, useEditForm } from "./edit-form.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type V = { name: string; url: string };
const BLANK: V = { name: "", url: "" };
const SCHEMA = z.object({ name: z.string().min(1, "Say a name."), url: z.string() });

let root: Root;
let host: HTMLDivElement;
let got: EditForm<V>;

function Probe({
  k,
  defaults,
  base,
}: {
  k: string | null;
  defaults: V;
  base?: string | undefined;
}) {
  got = useEditForm<V>({ key: k, defaults, schema: SCHEMA, base });
  return (
    <form onSubmit={got.onSend(async () => {})}>
      <TextField form={got} name="name" label="Name" />
    </form>
  );
}
const draw = (k: string | null, defaults: V = BLANK, base?: string) =>
  act(() => root.render(<Probe k={k} defaults={defaults} base={base} />));
const type = (name: keyof V, text: string) => act(() => got.setValue(name, text));

beforeEach(() => {
  for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("changedFrom", () => {
  it("keeps only what differs", () => {
    expect(changedFrom({ a: "x", b: ["1"] }, { a: "x", b: ["1", "2"] })).toEqual({ b: ["1", "2"] });
  });
});

describe("centsOf", () => {
  it("reads dollars as typed", () => {
    expect(centsOf("1,250.50")).toBe(125050);
    expect(centsOf("$12")).toBe(1200);
    expect(centsOf("12.345")).toBeNull();
    expect(centsOf("ten")).toBeNull();
  });
});

describe("useEditForm", () => {
  it("gives unsent values back after the form goes away", async () => {
    await draw("hook:new");
    await type("name", "CRM");
    expect(got.unsent).toBe(true);
    act(() => root.unmount());
    root = createRoot(host);
    await draw("hook:new");
    expect(got.getValues("name")).toBe("CRM");
    expect(got.restored).toBe(true);
  });

  it("marks the box for the edits guard", async () => {
    await draw("hook:mark");
    expect(host.querySelector("input")?.getAttribute("data-edit")).toBe("form:name");
  });

  it("keeps nothing under a null key", async () => {
    await draw(null);
    await type("name", "CRM");
    act(() => root.unmount());
    root = createRoot(host);
    await draw(null);
    expect(got.getValues("name")).toBe("");
  });

  it("shows a conflict when the starting point moved under kept values", async () => {
    await draw("hook:edit", { name: "Old", url: "" });
    await type("name", "Mine");
    act(() => root.unmount());
    root = createRoot(host);
    await draw("hook:edit", { name: "Theirs", url: "" });
    expect(got.conflict?.mine).toEqual({ name: "Mine" });
    expect(got.getValues("name")).toBe("Mine");
    await act(async () => got.takeTheirs());
    expect(got.getValues("name")).toBe("Theirs");
    expect(got.conflict).toBeNull();
  });

  it("checks the schema, sends, and forgets once it lands", async () => {
    await draw("hook:send");
    await act(async () => {
      host.querySelector("form")?.requestSubmit();
    });
    expect(host.textContent).toContain("Say a name.");
    await type("name", "CRM");
    const sent: V[] = [];
    await act(async () => {
      await got.onSend(async (v) => {
        sent.push(v);
      })();
    });
    expect(sent).toEqual([{ name: "CRM", url: "" }]);
    expect(got.unsent).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    await draw("hook:send");
    expect(got.restored).toBe(false);
  });

  it("keeps the values when the send doesn't land", async () => {
    await draw("hook:fail");
    await type("name", "CRM");
    await act(async () => {
      await got.onSend(async () => {
        throw new Error("Refused.");
      })();
    });
    expect(got.error).toBe("Refused.");
    expect(got.getValues("name")).toBe("CRM");
    expect(got.unsent).toBe(true);
  });

  it("a tab older than the live build keeps its words through the reload it is told to do (wa-ovo)", async () => {
    const STALE = "Wren was updated since this tab opened. Reload to send.";
    await draw("hook:stale");
    await type("name", "CRM");
    await act(async () => {
      await got.onSend(async () => {
        throw Object.assign(new Error(STALE), { status: 409, code: "stale" });
      })();
    });
    expect(got.error).toBe(STALE);
    // The reload: a new form under the same key gives the words back.
    act(() => root.unmount());
    root = createRoot(host);
    await draw("hook:stale");
    expect(got.getValues("name")).toBe("CRM");
    expect(got.restored).toBe(true);
    expect(got.conflict).toBeNull();
  });

  it("words typed after a send come back without a conflict once the server caught up", async () => {
    await draw("hook:after", { name: "Old", url: "" }, "v1");
    await type("name", "Sent");
    await act(async () => {
      await got.onSend(async () => {})();
    });
    await type("url", "https://example.com");
    act(() => root.unmount());
    root = createRoot(host);
    await draw("hook:after", { name: "Sent", url: "" }, "v2");
    expect(got.conflict).toBeNull();
    expect(got.restored).toBe(true);
    expect(got.getValues("url")).toBe("https://example.com");
  });
});
