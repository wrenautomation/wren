import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { autobrowseDo, DoFailed, type DoOutcome, doServiceFor, restateDo } from "./do.js";

const outcome: DoOutcome = {
  via: "site",
  name: "youtube POST /upload/youtube/v3/videos",
  input: { file: "a.mp4" },
  output: { id: "v1" },
  status: "done",
  built: null,
  session: null,
  summary: "answered",
};

describe("autobrowseDo over HTTP", () => {
  it("posts the goal, then waits on the job until it is done", async () => {
    const calls: string[] = [];
    let polls = 0;
    const doIt = autobrowseDo({
      url: "http://box/",
      token: "t",
      waitMs: 5,
      fetch: async (url, init) => {
        calls.push(`${init?.method} ${url}`);
        if (String(url).endsWith("/api/do")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            goal: "upload",
            inputs: { file: "a.mp4" },
          });
          return new Response(JSON.stringify({ id: "j1" }), { status: 202 });
        }
        polls++;
        return new Response(
          JSON.stringify(polls < 2 ? { status: "running" } : { status: "done", result: outcome }),
          { status: 200 },
        );
      },
    });
    expect(await doIt({ goal: "upload", inputs: { file: "a.mp4" } })).toEqual(outcome);
    expect(calls).toEqual([
      "POST http://box/api/do",
      "GET http://box/api/jobs/j1?wait=5",
      "GET http://box/api/jobs/j1?wait=5",
    ]);
  });

  it("a dry run answers at once; a refusal and a failed job are DoFailed", async () => {
    const dry = autobrowseDo({
      url: "http://box",
      fetch: async () =>
        new Response(JSON.stringify({ ...outcome, status: "planned" }), { status: 200 }),
    });
    expect((await dry({ goal: "upload", dryRun: true })).status).toBe("planned");
    const refused = autobrowseDo({
      url: "http://box",
      fetch: async () => new Response(JSON.stringify({ error: "an empty goal" }), { status: 400 }),
    });
    await expect(refused({ goal: "" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DoFailed && e.status === 400,
    );
    const failed = autobrowseDo({
      url: "http://box",
      fetch: async (url) =>
        String(url).endsWith("/api/do")
          ? new Response(JSON.stringify({ id: "j2" }), { status: 202 })
          : new Response(JSON.stringify({ status: "failed", error: "budget spent" }), {
              status: 200,
            }),
    });
    await expect(failed({ goal: "x" })).rejects.toThrow(/budget spent/);
  });
});

describe("restateDo", () => {
  it("wakes the box as a journaled step, calls do/run, surfaces terminal errors as DoFailed", async () => {
    const calls: string[] = [];
    const ctx = {
      run: async (name: string, fn: () => Promise<unknown>) => {
        calls.push(`run ${name}`);
        return fn();
      },
      serviceClient: () => ({
        run: async (req: { goal: string }) => {
          calls.push(`do/run ${req.goal}`);
          if (req.goal === "bad")
            throw new restate.TerminalError("nothing does it", { errorCode: 501 });
          return outcome;
        },
      }),
    } as unknown as restate.Context;
    expect(await restateDo(ctx, async () => "started")({ goal: "upload" })).toEqual(outcome);
    expect(calls).toEqual(["run wake autobrowse", "do/run upload"]);
    await expect(restateDo(ctx)({ goal: "bad" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DoFailed && e.status === 501,
    );
  });

  it("an owner's do: its own service, the owner named; no answer in time is a 504", async () => {
    expect(doServiceFor()).toBe("do");
    expect(doServiceFor("wren")).toBe("do");
    expect(doServiceFor("acme")).toBe("do_acme");
    const seen: { service: string; req: unknown }[] = [];
    let late = false;
    const ctx = {
      serviceClient: ({ name }: { name: string }) => ({
        run: (req: unknown) => {
          seen.push({ service: name, req });
          const p = Promise.resolve(outcome);
          return Object.assign(p, {
            orTimeout: () => (late ? Promise.reject(new restate.TimeoutError()) : p),
          });
        },
      }),
    } as unknown as restate.Context;
    const acme = restateDo(ctx, undefined, { owner: "acme", timeoutMs: 60_000 });
    expect(await acme({ goal: "add the partner" })).toEqual(outcome);
    expect(seen).toEqual([{ service: "do_acme", req: { goal: "add the partner", owner: "acme" } }]);
    late = true;
    await expect(acme({ goal: "add the partner" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DoFailed && e.status === 504,
    );
  });
});
