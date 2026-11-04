/** The relay's local token: one file, mode 600, made on first use. The page keeps a copy. */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TOKEN_FILE = join(homedir(), ".config", "wren", "agent-token");

export function localToken(file = TOKEN_FILE): string {
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const t = randomBytes(24).toString("base64url");
  writeFileSync(file, `${t}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return t;
}
