/**
 * A key's id: what a log line or a usage row says instead of the key. The first 12 hex
 * characters of the SHA-256 of the trimmed value. The same rule as credvault's `keyId` and
 * autobrowse's Exa ring fingerprint; wren copies it and imports neither (the test pins a vector).
 */
import { createHash } from "node:crypto";

export const keyId = (secret: string): string =>
  createHash("sha256").update(secret.trim()).digest("hex").slice(0, 12);
