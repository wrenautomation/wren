import { resolve } from "node:path";
import { z } from "zod";

export { loadEnvFile } from "./env-file.js";

/** All process settings. Read once at startup, passed down explicitly. */
export const settingsSchema = z.object({
  databaseUrl: z.string().url(),
  restateIngressUrl: z.string().url().default("http://127.0.0.1:8080"),
  inboxDir: z.string().min(1).default("inbox"),
  draftsDir: z.string().min(1).default("drafts"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Env var name for each setting. One place, so `.env.example` and code can't drift. */
export const ENV_KEYS = {
  databaseUrl: "WREN_DATABASE_URL",
  restateIngressUrl: "WREN_RESTATE_INGRESS_URL",
  inboxDir: "WREN_INBOX_DIR",
  draftsDir: "WREN_DRAFTS_DIR",
  logLevel: "WREN_LOG_LEVEL",
} as const satisfies Record<keyof Settings, string>;

export interface LoadOptions {
  /** Relative directory settings resolve against. Pass the value `loadEnvFile()` returned. */
  rootDir?: string;
}

/**
 * Parse settings from an env map. Missing optional keys take schema defaults.
 * Directory settings come back absolute so every process agrees on the path
 * regardless of which package it was started from.
 */
export function loadSettings(
  env: NodeJS.ProcessEnv = process.env,
  opts: LoadOptions = {},
): Settings {
  const raw: Record<string, string | undefined> = {};
  for (const [field, key] of Object.entries(ENV_KEYS)) {
    const value = env[key];
    if (value !== undefined && value !== "") raw[field] = value;
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `${ENV_KEYS[i.path[0] as keyof Settings]}: ${i.message}`,
    );
    throw new Error(`invalid settings:\n${lines.join("\n")}`);
  }
  const root = opts.rootDir ?? process.cwd();
  const s = parsed.data;
  return { ...s, inboxDir: resolve(root, s.inboxDir), draftsDir: resolve(root, s.draftsDir) };
}
