/**
 * Secrets for Lambda: SSM SecureStrings each holding a JSON object of env names to values,
 * applied to `process.env` before settings load. `WREN_SSM_ENV_PARAM` names one, or several
 * comma-separated (`/wren/prod/env,/wren/prod/env-2`), since one parameter caps at 8192
 * characters. Values set on the function itself win, then the first parameter that has a name.
 * `deploy/scripts/push-secrets.sh` writes them.
 */

import { writeFile } from "node:fs/promises";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/** What reading a parameter needs: an `SSMClient`, or a fake in tests. */
export interface SsmReader {
  send(cmd: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }>;
}

export function applyEnv(json: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("the SSM env parameter must hold a JSON object of NAME: value");
  }
  const applied: string[] = [];
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") throw new Error(`SSM env ${name}: value must be a string`);
    if (env[name] !== undefined) continue;
    env[name] = value;
    applied.push(name);
  }
  return applied;
}

async function readParameter(name: string, ssm: SsmReader = new SSMClient({})): Promise<string> {
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = out.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  return value;
}

/** The parameter names in a `WREN_SSM_ENV_PARAM` list. */
export const paramNames = (list: string | undefined): string[] =>
  (list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Why a later parameter may be skipped: not made yet, or the role can't read it yet. */
const skippable = (err: unknown) => {
  const name = (err as { name?: string } | null)?.name ?? "";
  return name === "ParameterNotFound" || name.startsWith("AccessDenied") ? name : null;
};

/**
 * Load each named parameter in order. No name = nothing to load (local runs, tests). The first
 * must load; a later one may not exist or be readable yet (it's skipped and named in the log), so
 * a list can ship before its parameter and grant do. Logs names only, never values.
 */
export async function loadSsmEnv(
  list: string | undefined,
  o: { ssm?: SsmReader; env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {},
): Promise<string[]> {
  const names = paramNames(list);
  if (!names.length) return [];
  const ssm = o.ssm ?? new SSMClient({});
  const applied: string[] = [];
  for (const [i, name] of names.entries()) {
    let json: string;
    try {
      json = await readParameter(name, ssm);
    } catch (err) {
      const why = skippable(err);
      if (i === 0 || !why) throw err;
      (o.log ?? console.warn)(`ssm env: ${name} ${why}, skipped`);
      continue;
    }
    applied.push(...applyEnv(json, o.env));
  }
  return applied;
}

/**
 * A file-shaped parameter (the sender roster) written to `path` so the code
 * that reads files reads it unchanged. The roster is config, not code: CI's
 * checkout never has it, so the bundle cannot be the place it lives.
 * Returns the path, or null when no parameter is named.
 */
export async function loadSsmFile(name: string | undefined, path: string): Promise<string | null> {
  if (!name) return null;
  await writeFile(path, await readParameter(name), { mode: 0o600 });
  return path;
}
