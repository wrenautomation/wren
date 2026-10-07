/**
 * The live door: a socket to a note's room only from our own page, signed in, never on the demo;
 * the room gets the person and the workspace from the Worker, a client's host pinned.
 */

import { PROTOCOL } from "@wren/notes/room";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import type { Site } from "../src/hosts.js";
import { liveRoute } from "../src/live.js";

const ID = "6f1c2c4e-0000-4000-8000-000000000001";

function rooms() {
  const joins: Record<string, unknown>[] = [];
  const names: string[] = [];
  const ns = {
    idFromName: (n: string) => {
      names.push(n);
      return n;
    },
    get: () => ({
      fetch: async (req: Request) => {
        joins.push(JSON.parse(req.headers.get("x-note-join") ?? "{}"));
        return new Response("joined");
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, joins, names };
}

const env = (r = rooms()): Env => ({
  ASSETS: {} as Fetcher,
  DEMO_HOST: "demo.test",
  RESTATE_INGRESS_URL: "https://restate.test",
  NOTE_ROOM: r.ns,
});

const open = (headers: Record<string, string> = {}, path = `/api/notes/live/${ID}?client=acme`) =>
  new Request(`https://app.test${path}`, {
    headers: {
      upgrade: "websocket",
      origin: "https://app.test",
      "sec-websocket-protocol": `${PROTOCOL}, tok`,
      ...headers,
    },
  });

const signedIn = async (req: Request) =>
  req.headers.get("authorization") === "Bearer tok"
    ? { email: "amy@firm.example" }
    : new Response("no", { status: 401 });

const app: Site = { kind: "app" };

describe("the live door", () => {
  it("joins the note's room as the signed-in person, in the workspace asked for", async () => {
    const r = rooms();
    const res = await liveRoute(open(), env(r), app, signedIn);
    expect(await res.text()).toBe("joined");
    expect(r.names).toEqual([ID]);
    expect(r.joins[0]).toMatchObject({
      id: ID,
      email: "amy@firm.example",
      as: { client: "acme", viewer: { email: "amy@firm.example" } },
    });
  });

  it("pins a client's host to that client, whatever the address asks", async () => {
    const r = rooms();
    await liveRoute(open(), env(r), { kind: "client", client: "firm" }, signedIn);
    expect(r.joins[0]).toMatchObject({ as: { client: "firm", asClient: true } });
  });

  it("refuses another site, no token, a bad token, the demo, a plain request, a bad id", async () => {
    const e = env();
    const status = async (req: Request, site: Site = app) =>
      (await liveRoute(req, e, site, signedIn)).status;
    expect(await status(open({ origin: "https://evil.example" }))).toBe(403);
    expect(await status(open({ origin: "" }))).toBe(403);
    expect(await status(open({ "sec-websocket-protocol": PROTOCOL }))).toBe(401);
    expect(await status(open({ "sec-websocket-protocol": `${PROTOCOL}, nope` }))).toBe(401);
    expect(await status(open(), { kind: "demo" })).toBe(404);
    expect(await status(open({ upgrade: "" }))).toBe(426);
    expect(await status(open({}, "/api/notes/live/../x"))).toBe(404);
  });

  it("says live isn't set up without the binding: the page syncs over HTTP", async () => {
    const { NOTE_ROOM: _, ...none } = env();
    const res = await liveRoute(open(), none, app, signedIn);
    expect(res.status).toBe(503);
  });
});
