/** Who the token names against who last signed in here: the first login keeps its reads in flight. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reload = vi.fn();
Object.assign(globalThis, {
  location: Object.assign(new URL("https://app.example.test/home"), { assign: vi.fn(), reload }),
});
vi.mock("./autotrack.js", () => ({ tellAutotrack: () => undefined }));
vi.mock("./write-socket.js", () => ({ startWriteSocket: () => null }));
const drop = vi.fn(async () => undefined);
const start = vi.fn(async (_: { owner: string | null }) => undefined);
vi.mock("@wren/ui", async (actual) => ({
  ...(await actual<typeof import("@wren/ui")>()),
  dropLocalCopy: drop,
  startLocalCopy: start,
}));

const kept = new Map<string, string>();
const jwt = (email: string) =>
  `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, email }))}.y`;
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A fresh page load signed in as `email`: the module reads the device again. */
async function signedInAs(email: string) {
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/api/auth/token")
        ? new Response(JSON.stringify({ token: jwt(email) }))
        : new Response("{}"),
    ),
  );
  const { authHeaders } = await import("./api.js");
  drop.mockClear();
  start.mockClear();
  await authHeaders();
  await settle();
}

beforeEach(() => kept.clear());
afterEach(() => {
  reload.mockClear();
  vi.unstubAllGlobals();
});

describe("the token's login", () => {
  it("first on this device: its copy opens, nothing is wiped", async () => {
    await signedInAs("a@example.test");
    expect(drop).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(start).toHaveBeenLastCalledWith({ owner: "a@example.test" });
  });

  it("the same login again: nothing changes", async () => {
    kept.set("wren.portal.owner", "a@example.test");
    await signedInAs("a@example.test");
    expect(drop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("someone else: the last copy is wiped and the page loads again", async () => {
    kept.set("wren.portal.owner", "a@example.test");
    await signedInAs("b@example.test");
    expect(drop).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(kept.get("wren.portal.owner")).toBe("b@example.test");
  });
});
