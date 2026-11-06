/**
 * Host setups: records on this Mac, outside the public repo (designs/2026-11-05-variants.md,
 * makers). A folder holds one `<name>.json` per setup; `<name>.md` beside it is its `append`.
 * Always owner-only and on the plan: a host file can name any cwd and any allow rule.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Setup } from "./setup.js";

const names = z.array(z.string().min(1));
// strict: a misspelt key fails the start, never drops a limit without a word
const Host = z.strictObject({
  title: z.string().min(1),
  app: z.string().min(1),
  cwd: z.string().min(1),
  model: z.string().min(1),
  models: names.optional(),
  tools: names.min(1),
  skills: names.default([]),
  plugins: names.default([]),
  allow: names.default([]),
  mode: z.literal("dontAsk").optional(),
  passEnv: names.default([]),
  vars: z.record(z.string(), z.string()).optional(),
  sandbox: z.record(z.string(), z.unknown()).optional(),
  serves: names.optional(),
});

const NAME = /^[a-z][a-z0-9-]*$/;

/** `taken`: the built-in setups; a host setup may not take a name or a title of theirs. */
export function hostSetups(dir: string, taken: readonly Setup[] = []): Setup[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const name = f.slice(0, -".json".length);
      const bad = (why: string) => new Error(`host setup ${f}: ${why}`);
      if (!NAME.test(name)) throw bad("the file name must be lower-case letters, digits, dashes");
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch (e) {
        throw bad(e instanceof Error ? e.message : String(e));
      }
      const r = Host.safeParse(json);
      if (!r.success) throw bad(z.prettifyError(r.error));
      const { models, mode, vars, sandbox, serves, ...rest } = r.data;
      if (taken.some((s) => s.name === name || s.title === rest.title))
        throw bad(`${name} / ${rest.title} is a built-in setup`);
      const md = join(dir, `${name}.md`);
      const append = existsSync(md) ? readFileSync(md, "utf8").trim() : "";
      return {
        name,
        ...rest,
        ...(models ? { models } : {}),
        ...(mode ? { mode } : {}),
        ...(vars ? { vars } : {}),
        ...(sandbox ? { sandbox } : {}),
        ...(serves ? { serves } : {}),
        ...(append ? { append } : {}),
        credentials: ["plan"],
        connection: "sdk",
        owner: true,
      } satisfies Setup;
    });
}
