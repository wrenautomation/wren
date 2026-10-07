/**
 * autobrowse's one verb from here: `do("upload this to youtube", {file})`.
 * The worker routes the goal to a site API, a compiled workflow or a
 * browser flow and runs it; with nothing ready its agent explores once and
 * what it achieved is compiled, so the next same ask is deterministic.
 * Two doors, one shape: HTTP (a laptop against a local autobrowse) and the
 * `do` Restate service (the worker, through Restate, no port on the box).
 */
import * as restate from "@restatedev/restate-sdk";
import type { FetchLike } from "../doh.js";
import type { Wake } from "./restate.js";

export interface DoRequest {
  goal: string;
  /** Named values the goal may use: a file path, a title, a domain. */
  inputs?: Record<string, string>;
  /** The site profile to work in; found from the goal when absent. */
  site?: string | null;
  /** Where the agent starts when it explores. */
  url?: string | null;
  /** Say what would run, run nothing. */
  dryRun?: boolean;
  /** Whose accounts it runs in; autobrowse refuses another owner's (409). None: the worker's own. */
  owner?: string | null;
}

export interface DoOutcome {
  via: "site" | "workflow" | "flow" | "agent" | "none";
  name: string | null;
  input: Record<string, unknown>;
  output: unknown;
  status: "done" | "needs-human" | "failed" | "planned";
  /** A workflow compiled from this run, for the next same ask. */
  built: string | null;
  /** The agent session, when one ran (open on `needs-human`). */
  session: string | null;
  summary: string;
}

export class DoFailed extends Error {
  readonly status: number;
  constructor(goal: string, status: number, message: string) {
    super(`do "${goal}": ${status} ${message}`);
    this.name = "DoFailed";
    this.status = status;
  }
}

export type Do = (req: DoRequest) => Promise<DoOutcome>;

/** Over HTTP: a dry run answers at once; a real one is a job this side waits on. */
export function autobrowseDo(o: {
  url: string;
  token?: string | null;
  fetch?: FetchLike;
  /** How long to wait on the job in one request (the worker caps it); polled until done. */
  waitMs?: number;
}): Do {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i));
  const base = o.url.replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
  };
  const json = async (res: Response, goal: string) => {
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok)
      throw new DoFailed(
        goal,
        res.status,
        (body as { error?: string } | null)?.error ?? res.statusText,
      );
    return body;
  };
  return async (req) => {
    const res = await doFetch(`${base}/api/do`, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
    });
    const body = await json(res, req.goal);
    if (res.status !== 202) return body as DoOutcome;
    const job = body as { id: string };
    for (;;) {
      const r = await doFetch(`${base}/api/jobs/${job.id}?wait=${o.waitMs ?? 25_000}`, {
        method: "GET",
        headers,
      });
      const j = (await json(r, req.goal)) as { status: string; result?: DoOutcome; error?: string };
      if (j.status === "done" && j.result) return j.result;
      if (j.status === "failed") throw new DoFailed(req.goal, 500, j.error ?? "failed");
    }
  };
}

type DoService = { run: (ctx: restate.Context, req: DoRequest) => Promise<DoOutcome> };

/** Wren's own autobrowse owner, whose service keeps the plain name. */
export const DO_OWNER = "wren";

/** autobrowse's Restate name for an owner's `do`: `do` for Wren's, `do_<owner>` for another's. */
export const doServiceFor = (owner: string = DO_OWNER): string =>
  owner === DO_OWNER ? "do" : `do_${owner}`;

/**
 * Through the invocation's context: one durable step; a goal that publishes runs once. With an
 * `owner`, the call goes to that owner's autobrowse and names it, so no other owner runs it.
 * With `timeoutMs`, a call still waiting then fails 504 (an owner whose worker isn't up).
 */
export function restateDo(
  ctx: restate.Context,
  wake?: Wake,
  o: { owner?: string; timeoutMs?: number } = {},
): Do {
  const client = ctx.serviceClient<DoService>({ name: doServiceFor(o.owner) });
  return async (req) => {
    if (wake) await ctx.run("wake autobrowse", wake);
    const ask = o.owner ? { ...req, owner: o.owner } : req;
    try {
      const call = client.run(ask);
      return await (o.timeoutMs ? call.orTimeout(o.timeoutMs) : call);
    } catch (err) {
      if (err instanceof restate.TimeoutError)
        throw new DoFailed(
          req.goal,
          504,
          `no answer in ${Math.round((o.timeoutMs ?? 0) / 60_000)} minutes`,
        );
      if (err instanceof restate.TerminalError)
        throw new DoFailed(req.goal, err.code ?? 500, err.message);
      throw err;
    }
  };
}
