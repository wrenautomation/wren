import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServiceAccountKey, ServiceAccountKeyError } from "./google-auth.js";

const KEY = {
  type: "service_account",
  client_email: "sender@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
};

describe("loadServiceAccountKey", () => {
  it("reads a key file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wren-key-"));
    const path = join(dir, "key.json");
    writeFileSync(path, JSON.stringify(KEY));
    const key = loadServiceAccountKey(path);
    expect(key.clientEmail).toBe(KEY.client_email);
    expect(key.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it("accepts the key's JSON inline, for hosts without a key file", () => {
    const key = loadServiceAccountKey(JSON.stringify(KEY));
    expect(key.clientEmail).toBe(KEY.client_email);
    expect(key.privateKey).toBe(KEY.private_key);
  });

  it("names the env var, not the value, when inline JSON is bad", () => {
    const err = (() => {
      try {
        loadServiceAccountKey('{"type": "service_account", "private_key": "hunter2"');
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ServiceAccountKeyError);
    expect(err?.message).toContain("WREN_GOOGLE_SERVICE_ACCOUNT");
    expect(err?.message).not.toContain("hunter2");
  });

  it("names the missing file", () => {
    expect(() => loadServiceAccountKey("/nope/key.json")).toThrow(/not found at \/nope\/key.json/);
  });
});
