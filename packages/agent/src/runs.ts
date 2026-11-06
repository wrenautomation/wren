/**
 * Headless runs (designs/2026-11-05-variants.md, C3): one prompt to a setup with no page, queued
 * and held by the relay. An agent starts one with `maker` (bin/maker.mjs) or `wren agent run`; this
 * is the record and the HTTP client both use.
 */

/** Child env of a `runs` session: where the relay is, and the session's own token. */
export const RUN_ENV = { url: "WREN_AGENT_URL", token: "WREN_AGENT_TOKEN" } as const;

export interface Run {
  id: string;
  setup: string;
  state: "queued" | "running" | "done" | "failed" | "stopped";
  prompt: string;
  model?: string;
  at: string;
  started?: string;
  ended?: string;
  /** The Claude session: its person may open it in the setup's chat. */
  session?: string;
  /** The last turn's text, or why the run failed. */
  result?: string;
  /** Tool calls no rule allowed: denied, since no person answers. */
  denied: string[];
  usd?: number;
}

/** A setup as `GET /setups` lists it; a maker is an owner setup. */
export interface MakerInfo {
  name: string;
  title: string;
  app: string;
  model: string;
  models: string[];
  owner?: true;
  serves?: string[];
}

export class RunError extends Error {}

export function runClient(o: { url: string; token: string }) {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${o.url}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
      });
    } catch {
      throw new RunError(`no relay at ${o.url}: start it with \`wren agent serve\``);
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new RunError(body.error ?? `relay answered ${res.status}`);
    return body;
  };
  const setups = () => call<MakerInfo[]>("/setups");
  return {
    setups,
    makers: async () => (await setups()).filter((s) => s.owner),
    start: (setup: string, prompt: string, model?: string) =>
      call<Run>(`/s/${setup}/runs`, {
        method: "POST",
        body: JSON.stringify({ prompt, ...(model ? { model } : {}) }),
      }),
    /** The asker's runs of one setup, or of every setup they may open; newest first. */
    list: async (setup?: string): Promise<Run[]> => {
      const names = setup ? [setup] : (await setups()).map((s) => s.name);
      const all = await Promise.all(
        names.map((n) => call<Run[]>(`/s/${n}/runs`).catch(() => [] as Run[])),
      );
      return all.flat().sort((a, b) => b.at.localeCompare(a.at));
    },
    get: async (id: string): Promise<Run> => {
      for (const s of await setups()) {
        const r = await call<Run>(`/s/${s.name}/runs/${id}`).catch(() => null);
        if (r) return r;
      }
      throw new RunError(`no run ${id}`);
    },
    stop: async (id: string): Promise<Run> => {
      for (const s of await setups()) {
        const r = await call<Run>(`/s/${s.name}/runs/${id}/stop`, { method: "POST" }).catch(
          () => null,
        );
        if (r) return r;
      }
      throw new RunError(`no run ${id}`);
    },
  };
}
