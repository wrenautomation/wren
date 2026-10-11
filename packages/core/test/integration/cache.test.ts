/**
 * The cache against a real Valkey in Docker, set up as the box runs it: TLS on a self-signed
 * certificate, a password, the client pinning the certificate's fingerprint.
 */
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readThrough, valkeyCache } from "../../src/cache.js";
import { respClient } from "../../src/resp.js";

const IMAGE = "valkey/valkey:8.1.1-alpine";
const PASSWORD = "test-password";
let dir: string;
let id: string;
let port: number;
let fp: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wren-valkey-"));
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-keyout",
    join(dir, "server.key"),
    "-out",
    join(dir, "server.crt"),
  ]);
  // mkdtemp makes the dir 0700: on Linux the container's valkey user could not open it.
  execFileSync("chmod", ["755", dir]);
  execFileSync("chmod", ["644", join(dir, "server.key")]);
  fp = new X509Certificate(readFileSync(join(dir, "server.crt"))).fingerprint256;
  id = execFileSync("docker", [
    "run",
    "-d",
    "-p",
    "127.0.0.1::6380",
    "-v",
    `${dir}:/tls:ro`,
    IMAGE,
    "valkey-server",
    "--port",
    "0",
    "--tls-port",
    "6380",
    "--tls-cert-file",
    "/tls/server.crt",
    "--tls-key-file",
    "/tls/server.key",
    "--tls-auth-clients",
    "no",
    // The box's one login (deploy/scripts/box-valkey.sh).
    "--user",
    "default",
    "on",
    `>${PASSWORD}`,
    "~wren:*",
    "resetchannels",
    "-@all",
    "+get",
    "+set",
    "+del",
    "+ping",
  ])
    .toString()
    .trim();
  let out: string;
  try {
    out = execFileSync("docker", ["port", id, "6380"]).toString();
  } catch {
    // Exited at start: say why, not "no public port".
    throw new Error(`valkey did not start: ${execFileSync("docker", ["logs", id]).toString()}`);
  }
  port = Number(out.trim().split(":").pop());
}, 120_000);

afterAll(() => {
  if (id) execFileSync("docker", ["rm", "-f", id]);
  rmSync(dir, { recursive: true, force: true });
});

const url = (pin: string, pw = PASSWORD) =>
  `rediss://default:${pw}@localhost:${port}/?fp=${encodeURIComponent(pin)}`;

/** Valkey takes a moment to listen after the container starts. */
async function ready() {
  for (let i = 0; i < 50; i++) {
    const c = respClient(url(fp), { timeoutMs: 2000 });
    try {
      if ((await c.send("PING")) === "PONG") return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      c.close();
    }
  }
  throw new Error("valkey never answered");
}

describe("valkeyCache", () => {
  it("sets, gets, expires and deletes over pinned TLS with a password", async () => {
    await ready();
    const c = valkeyCache(url(fp));
    await c.set("a", "1", 60_000);
    expect(await c.get("a")).toBe("1");
    await c.del("a");
    expect(await c.get("a")).toBeNull();
    await c.set("short", "x", 50);
    await new Promise((r) => setTimeout(r, 120));
    expect(await c.get("short")).toBeNull();
    expect(await readThrough(c, "obj", 60_000, async () => ({ n: 2 }))).toEqual({ n: 2 });
    expect(await c.get("obj")).toBe('{"n":2}');
    // The login reaches only its own commands.
    const raw = respClient(url(fp));
    await expect(raw.send("FLUSHALL")).rejects.toThrow(/NOPERM/);
    await expect(raw.send("GET", "other")).rejects.toThrow(/NOPERM/);
    raw.close();
  }, 30_000);

  it("refuses a certificate that does not match its pin, and a wrong password", async () => {
    await ready();
    const wrongPin = respClient(url("00:11"));
    await expect(wrongPin.send("PING")).rejects.toThrow(/pin/);
    const wrongPw = respClient(url(fp, "nope"));
    await expect(wrongPw.send("PING")).rejects.toThrow(/WRONGPASS|invalid/);
    wrongPw.close();
  }, 30_000);
});
