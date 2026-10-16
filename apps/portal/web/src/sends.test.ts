/**
 * Every send the portal offers reaches the Worker with its request id and this tab's build, from
 * every surface that presses it (wa-ovo): a dialog, a row's own box, a record's inline box, a
 * hand-drawn page's own call. Real web path (callOf, Runner, pressAct, WRITES, api.ts) into the
 * real Worker, with only Restate and sign-in faked. And a tab older than the live build is told
 * to reload, keeping its words.
 */
import type { Action } from "@wren/ui";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STALE_CODE, STALE_SEND } from "../../src/build.js";
import { isSend, SEND_HANDLERS, SENDS } from "../../src/services.js";

const TAB_BUILD = "b-tab";
Object.assign(globalThis, {
  location: Object.assign(new URL("https://app.example.test/marketing/inbox"), {
    assign: vi.fn(),
    reload: vi.fn(),
  }),
});
vi.mock("./autotrack.js", () => ({ tellAutotrack: () => undefined }));
vi.mock("./write-socket.js", () => ({ startWriteSocket: () => null }));

const { MODULES } = await import("./modules/index.js");
const { callOf } = await import("./records.js");
const { call, ApiError } = await import("./api.js");
const { conflictOf, Runner, pressAct, say, WRITES } = await import("@wren/ui");
// The Worker, untyped here: its types are the Workers runtime's, this program's are the DOM's.
const WORKER = "../../src/worker.js";
const worker = ((await import(/* @vite-ignore */ WORKER)) as { default: Worker }).default;
interface Worker {
  fetch(req: Request, env: Deploy, ctx: unknown): Promise<Response>;
}
type Deploy = Record<string, unknown>;

// The page as built: its build id in a meta tag (vite.config.ts `buildId`), read on the first call.
vi.stubGlobal("document", {
  visibilityState: "visible",
  hidden: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  querySelector: (sel: string) => (sel.includes("wren-build") ? { content: TAB_BUILD } : null),
});

const AUTH = "https://auth.example.test";
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const WORDS = "Synthetic words";

const enc = (v: unknown) =>
  btoa(typeof v === "string" ? v : JSON.stringify(v))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
let keys: CryptoKeyPair;
async function token() {
  const head = enc({ alg: "EdDSA", kid: "k1", typ: "JWT" });
  const body = enc({
    aud: ["wren"],
    iss: AUTH,
    sub: "u1",
    exp: Math.floor(Date.now() / 1000) + 600,
    email: "op@example.test",
  });
  const sig = await crypto.subtle.sign(
    "Ed25519",
    keys.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return `${head}.${body}.${enc(bin)}`;
}

/** The deploy: its assets carry `build.json` with the live build's id. */
const deployOf = (live: string): Deploy => ({
  ASSETS: {
    fetch: async (req: Request) =>
      new URL(req.url).pathname === "/build.json"
        ? Response.json({ id: live })
        : new Response("<!doctype html>app", { headers: { "content-type": "text/html" } }),
  },
  APP_HOST: "app.example.test",
  DEMO_HOST: "demo.example.test",
  AUTH_ORIGIN: AUTH,
  RESTATE_INGRESS_URL: "https://restate.test:8080/",
  RESTATE_AUTH_TOKEN: "rt",
});
let deploy = deployOf(TAB_BUILD);

/** What reached the Worker, and what it sent on to Restate. */
interface Seen {
  path: string;
  body: Record<string, unknown>;
  build: string | null;
  status: number;
  /** What the Worker sent Restate for it. */
  forwarded: { url: string; key: string | null }[];
}
const seen: Seen[] = [];
const restate: { url: string; key: string | null }[] = [];
let inflight = 0;
/** False while the pages' actions are sorted: each call answered at once, the Worker skipped. */
let toWorker = true;
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined };

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `${AUTH}/api/auth/token`) return Response.json({ token: await token() });
    if (url === `${AUTH}/api/auth/jwks`) {
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      return Response.json({ keys: [{ ...jwk, alg: "EdDSA", kid: "k1" }] });
    }
    if (url.startsWith("https://restate.test")) {
      restate.push({ url, key: new Headers(init.headers).get("idempotency-key") });
      return Response.json({ done: [1] });
    }
    if (!url.startsWith("/api/")) throw new Error(`unexpected fetch ${url}`);
    inflight++;
    try {
      if (!toWorker) {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        seen.push({ path: url.slice(5), body, build: null, status: 200, forwarded: [] });
        return Response.json({ done: [1] });
      }
      const req = new Request(`https://app.example.test${url}`, init);
      const build = req.headers.get("x-wren-build");
      const at = restate.length;
      const res = await worker.fetch(req, deploy, ctx);
      const path = url.slice("/api/".length);
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      seen.push({ path, body, build, status: res.status, forwarded: restate.slice(at) });
      // A send the server took: its outcome is pushed, as the write socket does.
      if (res.status === 202 && typeof body.requestId === "string") {
        const id = body.requestId;
        setTimeout(() => WRITES.heard(id, { state: "sent", answer: { done: [1] } }), 0);
      }
      return res;
    } finally {
      inflight--;
    }
  });
});
afterAll(() => vi.unstubAllGlobals());

const tick = () => new Promise((r) => setTimeout(r, 1));
/** Until nothing is on the wire for a few ticks running. */
async function quiet() {
  for (let still = 0, n = 0; still < 4 && n < 400; n++) {
    await tick();
    still = inflight === 0 ? still + 1 : 0;
  }
}

/** The send a Worker request is: its route, or the handler `console/call` names. */
const sendOf = (s: Seen): string | null => {
  const { requestId: _, ...bare } = s.body;
  if (!isSend(s.path, bare)) return null;
  return s.path === "console/call" ? `${String(bare.service)}/${String(bare.handler)}` : s.path;
};

/** What a box or dialog sends: the asked field filled, and what a reply box adds. */
const inputOf = (a: Action, id: string, surface: string): Record<string, unknown> => ({
  ids: [id],
  body: `${WORDS} (${surface})`,
  ...(a.ask ? { [a.ask.field]: `${WORDS} (${surface})` } : {}),
  channel: "reddit",
  target: "t1_synthetic",
  ref: "t1_synthetic",
  account: "acct-1",
});

type Surface = (
  a: Action,
  run: (h: string, i: Record<string, unknown>) => Promise<unknown>,
) => Promise<void>;
const runnerFor = (callIt: (h: string, i: Record<string, unknown>) => Promise<unknown>) =>
  new Runner({
    call: callIt,
    after: () => undefined,
    many: "rows",
    toast: { success: () => undefined, error: () => undefined },
  });
const SURFACES: Record<string, Surface> = {
  // A head or bulk button: its dialog, then submit (an undo action runs on the press).
  dialog: async (a, run) => {
    const r = runnerFor(run);
    if (r.run(a, ["1"]) === "asked") await r.submit(inputOf(a, "1", "dialog"));
  },
  // A row's own box (a list row's reply), no dialog.
  box: async (a, run) => {
    await runnerFor(run).send(a, ["1"], inputOf(a, "1", "box"));
  },
  // A record's inline box (the Inbox's conversation, a thread's reply): `RecordAct`.
  inline: async (a, run) => {
    const { ids: _, ...input } = inputOf(a, "1", "inline");
    await pressAct(run, a, "1", "rows:1", input).catch(() => undefined);
  },
};

describe("every send, from every surface (wa-ovo)", () => {
  it("reaches the Worker with a request id and this tab's build, and Restate once by it", async () => {
    // Every action of every page, once per caller (Wren's own apps as Wren, a client's for it):
    // the ones whose call is a send, by what leaves the tab.
    const sending: { where: string; a: Action; client: string | null }[] = [];
    const pressed = new Set<string>();
    toWorker = false;
    for (const m of MODULES) {
      const client = m.requires?.audience === "team" ? null : "client-1";
      for (const page of m.pages)
        for (const a of "actions" in page ? (page.actions ?? []) : []) {
          const once = `${client} ${a.id} ${a.handler}`;
          if (pressed.has(once)) continue;
          pressed.add(once);
          const from = seen.length;
          await SURFACES.box?.(a, callOf(client)).catch(() => undefined);
          await quiet();
          if (seen.slice(from).some(sendOf))
            sending.push({ where: `${m.id}/${page.id}`, a, client });
        }
    }
    toWorker = true;
    // Each of those, from every surface, into the Worker.
    const covered = new Map<string, Set<string>>();
    for (const { where: page, a, client } of sending)
      for (const [surface, press] of Object.entries(SURFACES)) {
        const from = seen.length;
        await press(a, callOf(client)).catch(() => undefined);
        await quiet();
        for (const s of seen.slice(from)) {
          const send = sendOf(s);
          if (!send) continue;
          const where = `${page} ${a.id} (${surface}) -> ${send}`;
          expect(s.body.requestId, where).toMatch(REQUEST_ID);
          expect(s.build, where).toBe(TAB_BUILD);
          expect(s.status, where).toBe(202);
          // Taken by Restate once, under a key made from the request id.
          expect(
            s.forwarded.map((r) => r.url.endsWith("/send") && !!r.key),
            where,
          ).toEqual([true]);
          covered.set(send, (covered.get(send) ?? new Set()).add(surface));
        }
      }
    // Every send the Worker knows is offered somewhere, and each one pressed from every surface.
    const all = [...SENDS, ...SEND_HANDLERS].sort();
    expect([...covered.keys()].sort()).toEqual(all);
    for (const send of all) expect([...(covered.get(send) ?? [])], send).toHaveLength(3);
  }, 120_000);

  it("a hand-drawn page's own call gets its request id too", async () => {
    const from = seen.length;
    await call("console/call", {
      service: "InboxDesk",
      handler: "reply",
      input: { thread: "comment:2", channel: "reddit", target: "t1_synthetic", body: WORDS },
      confirm: "reply",
    });
    await call("sms/reply", { id: 2, body: WORDS });
    const sent = seen.slice(from).filter((s) => sendOf(s));
    expect(sent.map(sendOf)).toEqual(["InboxDesk/reply", "sms/reply"]);
    for (const s of sent) {
      expect(s.body.requestId).toMatch(REQUEST_ID);
      expect(s.status).toBe(202);
    }
  });
});

describe("a tab older than the live build (wa-ovo)", () => {
  const reply = (all: Action[]) => all.find((a) => a.handler === "inbox/reply") as Action;
  const inbox = () =>
    MODULES.flatMap((m) => m.pages.flatMap((p) => ("actions" in p ? (p.actions ?? []) : [])));

  it("is told to reload to send, keeps the words, and nothing reaches Restate", async () => {
    deploy = deployOf("b-next");
    const told = vi.spyOn(say, "stale").mockImplementation(() => undefined);
    const before = restate.length;
    const a = reply(inbox());
    // The inline box (the Inbox's conversation): the press fails with the reload line.
    const err = await pressAct(callOf(null), a, "comment:3", "rows:comment:3", {
      channel: "reddit",
      target: "t1_synthetic",
      body: `${WORDS} (stale)`,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: STALE_CODE, message: STALE_SEND });
    expect(told).toHaveBeenCalledWith(STALE_SEND);
    // A 409, yet no edit conflict: no Keep mine over someone else's words.
    expect(conflictOf(err)).toBe(false);
    // WRITES keeps the press as failed with its words, and never sends it again by itself.
    const press = WRITES.lastOn("rows:comment:3");
    expect(press?.error).toBe(STALE_SEND);
    expect(press?.status).toBe("failed");
    expect(press?.input).toMatchObject({ body: `${WORDS} (stale)` });
    // A dialog stays open with its words and says why.
    const r = runnerFor(callOf(null));
    const send = { ...a, ask: { field: "body", label: "Reply" } } as Action;
    expect(r.run(send, ["comment:4"], `${WORDS} (dialog)`)).toBe("asked");
    expect(await r.submit({ ids: ["comment:4"], body: `${WORDS} (dialog)` })).toBe(false);
    expect(r.snapshot().asked).toMatchObject({ start: `${WORDS} (dialog)`, error: STALE_SEND });
    await quiet();
    expect(restate.slice(before)).toEqual([]);
    told.mockRestore();
    deploy = deployOf(TAB_BUILD);
  });
});
