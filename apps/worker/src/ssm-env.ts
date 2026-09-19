/**
 * Secrets for Lambda: one SSM SecureString holding a JSON object of env
 * names to values, applied to `process.env` before settings load. Values set
 * on the function itself win, so a single variable can be overridden without
 * rewriting the parameter. `deploy/scripts/push-secrets.sh` writes it.
 */

import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

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

/** No parameter named = nothing to load (local runs, tests). */
export async function loadSsmEnv(name: string | undefined): Promise<string[]> {
  if (!name) return [];
  const ssm = new SSMClient({});
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = out.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  return applyEnv(value);
}
