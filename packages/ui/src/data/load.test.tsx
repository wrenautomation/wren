// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Load, nameScope, QUERIES, useLoad } from "./query.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Rows = { key: string; rows: string[] };

/** Run `fn`, then let the query layer's own timers (it batches its news) and React settle. */
const later = (fn: () => void = () => undefined) =>
  act(async () => {
    fn();
    await new Promise((r) => setTimeout(r, 10));
  });

/** A read that answers when told: the loading state, held. */
function held() {
  const asks: { key: string; answer: (rows: string[]) => Promise<void> }[] = [];
  const read = (key: string) =>
    new Promise<Rows>((resolve) => {
      asks.push({
        key,
        answer: (rows) => later(() => resolve({ key, rows })),
      });
    });
  return { asks, read };
}

let root: Root;
let host: HTMLDivElement;
let got: Load<Rows>;

/** A page the way the kit draws one: a skeleton until there is an answer, then its rows. */
function Page({
  k,
  read,
  scope,
}: {
  k: string | null;
  read: (k: string) => Promise<Rows>;
  scope?: object;
}) {
  got = useLoad<Rows>(k, () => read(k ?? ""), scope);
  return (
    <div>
      {got.pending ? (
        <p>skeleton</p>
      ) : (
        <ul style={{ opacity: got.placeholder ? 0.6 : 1 }}>
          {got.data?.rows.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const draw = (k: string | null, read: (k: string) => Promise<Rows>, scope?: object) =>
  act(() => root.render(<Page k={k} read={read} {...(scope ? { scope } : {})} />));
const shown = () => [...host.querySelectorAll("li")].map((li) => li.textContent);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  QUERIES.clear();
});

describe("useLoad states", () => {
  it("the first read has no answer to show: pending, a skeleton, then the rows", async () => {
    const r = held();
    await draw("first", r.read);
    expect(got).toMatchObject({ data: null, loading: true, pending: true, placeholder: false });
    expect(host.textContent).toBe("skeleton");
    await r.asks[0]?.answer(["a", "b"]);
    expect(got).toMatchObject({ loading: false, pending: false, placeholder: false });
    expect(shown()).toEqual(["a", "b"]);
  });

  it("a refetch keeps the rows on screen: loading, never pending or placeholder", async () => {
    const r = held();
    await draw("again", r.read);
    await r.asks[0]?.answer(["a", "b"]);
    await later(() => got.retry());
    expect(r.asks).toHaveLength(2);
    // The read is out: the old rows stay, the skeleton does not come back, nothing dims.
    expect(got).toMatchObject({ loading: true, pending: false, placeholder: false });
    expect(got.data?.rows).toEqual(["a", "b"]);
    expect(shown()).toEqual(["a", "b"]);
    expect(host.textContent).not.toContain("skeleton");
    await r.asks[1]?.answer(["a", "b", "c"]);
    expect(got).toMatchObject({ loading: false, pending: false });
    expect(shown()).toEqual(["a", "b", "c"]);
  });

  it("a new key holds the last key's rows and says so (placeholder), then swaps", async () => {
    const r = held();
    await draw("one", r.read);
    await r.asks[0]?.answer(["a"]);
    await draw("two", r.read);
    expect(got).toMatchObject({ loading: true, pending: false, placeholder: true });
    expect(shown()).toEqual(["a"]);
    await r.asks[1]?.answer(["z"]);
    expect(got).toMatchObject({ loading: false, pending: false, placeholder: false });
    expect(shown()).toEqual(["z"]);
  });

  it("an answer kept for the key shows at once, and its read again changes only loading", async () => {
    const r = held();
    const scope = nameScope({}, "load-test-kept");
    await draw("kept", r.read, scope);
    await r.asks[0]?.answer(["a"]);
    // The page unmounts; the next page on the same key opens.
    act(() => root.unmount());
    root = createRoot(host);
    await draw("kept", r.read, scope);
    expect(r.asks).toHaveLength(2);
    expect(got).toMatchObject({ loading: true, pending: false, placeholder: false });
    expect(shown()).toEqual(["a"]);
    await r.asks[1]?.answer(["a", "b"]);
    expect(shown()).toEqual(["a", "b"]);
  });

  it("a null key reads nothing: not pending, not loading", async () => {
    const r = held();
    await draw(null, r.read);
    expect(got).toMatchObject({ data: null, loading: false, pending: false, placeholder: false });
    expect(r.asks).toHaveLength(0);
  });

  it("a failed first read ends the skeleton: the error shows, not pending", async () => {
    await draw("bad", () => Promise.reject(new Error("no")));
    await later();
    expect(got).toMatchObject({ data: null, loading: false, pending: false });
    expect(got.error?.message).toBe("no");
  });
});
