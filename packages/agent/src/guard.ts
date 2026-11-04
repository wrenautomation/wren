/**
 * CLI → page: the credential check. The CLI's init names what it bills (`apiKeySource`); a plan
 * session that reports anything but `none` is ended before its first model call returns.
 */
import type { Credential } from "./launch.js";

export function credentialBreach(frame: unknown, cred: Credential): string | null {
  if (typeof frame !== "object" || frame === null) return null;
  const f = frame as { type?: unknown; subtype?: unknown; apiKeySource?: unknown };
  if (f.type !== "system" || f.subtype !== "init") return null;
  const want = cred.kind === "plan" ? "none" : "ANTHROPIC_API_KEY";
  return f.apiKeySource === want
    ? null
    : `credential ${cred.kind} expects apiKeySource ${want}, the CLI reports ${String(f.apiKeySource)}`;
}
