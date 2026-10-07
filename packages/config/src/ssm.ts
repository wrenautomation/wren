/**
 * Secrets for Lambda: one SSM SecureString holding a JSON object of env
 * names to values, applied to `process.env` before settings load. Values set
 * on the function itself win, so a single variable can be overridden without
 * rewriting the parameter. `deploy/scripts/push-secrets.sh` writes it.
 */

import { writeFile } from "node:fs/promises";
import {
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";

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

async function readParameter(name: string): Promise<string> {
  const ssm = new SSMClient({});
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = out.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  return value;
}

/** No parameter named = nothing to load (local runs, tests). */
export async function loadSsmEnv(name: string | undefined): Promise<string[]> {
  if (!name) return [];
  return applyEnv(await readParameter(name));
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

/**
 * Clients' own vendor keys (designs/2026-10-07-setup-and-vendors.md): SecureStrings at credvault's
 * owner path layout. Postgres keeps the name. Writing needs `ssm:PutParameter` on the owners path,
 * which the worker's role does not have yet: until then a save fails and says so.
 */
export function ssmKeyStore(client: SSMClient = new SSMClient({})) {
  return {
    async put(name: string, value: string): Promise<void> {
      await client.send(
        new PutParameterCommand({
          Name: name,
          Value: value,
          Type: "SecureString",
          Overwrite: true,
        }),
      );
    },
    async get(name: string): Promise<string | null> {
      try {
        const out = await client.send(
          new GetParameterCommand({ Name: name, WithDecryption: true }),
        );
        return out.Parameter?.Value ?? null;
      } catch (err) {
        if (err instanceof ParameterNotFound) return null;
        throw err;
      }
    },
  };
}
