/**
 * The cache against a real Redis in Docker, run as the box runs it: the image, memory cap and
 * config of deploy/scripts/box-redis.sh (its CONF lines, read from the script), TLS on a
 * self-signed certificate, the client pinning the certificate's fingerprint.
 */
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readThrough, redisCache } from "../../src/cache.js";
import { RespError, respClient } from "../../src/resp.js";

const BOX = readFileSync(
  new URL("../../../../deploy/scripts/box-redis.sh", import.meta.url),
  "utf8",
);
const IMAGE = BOX.match(/^image=(\S+)$/m)?.[1] ?? "";
const PASSWORD = "test-password";
let dir: string;
let id: string;
let port: number;
let fp: string;

beforeAll(() => {
  const conf = BOX.match(/<<CONF\n([\s\S]*?)\nCONF\n/)?.[1];
  if (!IMAGE || !conf) throw new Error("box-redis.sh: no image= line or CONF block");
  dir = mkdtempSync(join(tmpdir(), "wren-redis-"));
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
  writeFileSync(join(dir, "redis.conf"), `${conf.replace("$pw", PASSWORD)}\n`);
  // mkdtemp makes the dir 0700: on Linux the container's redis user could not open it.
  execFileSync("chmod", ["755", dir]);
  execFileSync("chmod", ["644", join(dir, "server.key"), join(dir, "redis.conf")]);
  fp = new X509Certificate(readFileSync(join(dir, "server.crt"))).fingerprint256;
  id = execFileSync("docker", [
    "run",
    "-d",
    "--memory",
    "128m",
    "-p",
    "127.0.0.1::6380",
    "-v",
    `${dir}:/etc/redis:ro`,
    IMAGE,
    "redis-server",
    "/etc/redis/redis.conf",
  ])
    .toString()
    .trim();
  port = hostPort();
}, 120_000);

afterAll(() => {
  if (id) execFileSync("docker", ["rm", "-f", id]);
  rmSync(dir, { recursive: true, force: true });
});

function hostPort(): number {
  let out: string;
  try {
    out = execFileSync("docker", ["port", id, "6380"]).toString();
  } catch {
    // Exited at start: say why, not "no public port".
    throw new Error(`redis did not start: ${execFileSync("docker", ["logs", id]).toString()}`);
  }
  return Number(out.trim().split("\n")[0]?.split(":").pop());
}

/** Big values on a busy Mac: past the client's 500 ms default. */
const slow = () => redisCache(url(fp), respClient(url(fp), { timeoutMs: 10_000 }));

const url = (pin: string, pw = PASSWORD) =>
  `rediss://default:${pw}@localhost:${port}/?fp=${encodeURIComponent(pin)}`;

/** Redis takes a moment to listen after the container starts. */
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
  throw new Error("redis never answered");
}

describe("redisCache", () => {
  it("sets, gets, expires and deletes over pinned TLS with a password", async () => {
    await ready();
    const c = slow();
    await c.set("a", "1", 60_000);
    expect(await c.get("a")).toBe("1");
    await c.set("a", "2", 60_000);
    expect(await c.get("a")).toBe("2");
    await c.set("b", "3", 60_000);
    await c.del("a", "b");
    expect(await c.get("a")).toBeNull();
    expect(await c.get("b")).toBeNull();
    await c.del();
    await c.set("short", "x", 50);
    await new Promise((r) => setTimeout(r, 120));
    expect(await c.get("short")).toBeNull();
    await c.set("sub-ms", "x", 0.2);
    expect(await readThrough(c, "obj", 60_000, async () => ({ n: 2 }))).toEqual({ n: 2 });
    expect(await c.get("obj")).toBe('{"n":2}');
    const text = "é ✓ \r\n $5 *2 -ERR";
    await c.set("utf8", text, 60_000);
    expect(await c.get("utf8")).toBe(text);
    const big = "x".repeat(512 * 1024);
    await c.set("big", big, 60_000);
    expect(await c.get("big")).toBe(big);
    // Commands in order, replies matched by position.
    const many = await Promise.all(
      Array.from({ length: 50 }, (_, i) => c.set(`p${i}`, String(i), 60_000)),
    );
    expect(many).toHaveLength(50);
    expect(await Promise.all(Array.from({ length: 50 }, (_, i) => c.get(`p${i}`)))).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i)),
    );
  }, 30_000);

  it("lets the login reach only GET, SET, DEL and PING on wren:* keys", async () => {
    await ready();
    const raw = respClient(url(fp));
    expect(await raw.send("SET", "wren:k", "v")).toBe("OK");
    expect(await raw.send("GET", "wren:k")).toBe("v");
    expect(await raw.send("DEL", "wren:k")).toBe(1);
    const denied: string[][] = [
      ["GET", "other"],
      ["SET", "other", "v"],
      ["DEL", "other"],
      ["FLUSHALL"],
      ["FLUSHDB"],
      ["KEYS", "*"],
      ["SCAN", "0"],
      ["CONFIG", "GET", "maxmemory"],
      ["CONFIG", "SET", "save", "60 1"],
      ["INFO"],
      ["ACL", "WHOAMI"],
      ["EVAL", "return 1", "0"],
      ["FUNCTION", "LIST"],
      ["MODULE", "LIST"],
      ["SHUTDOWN"],
      ["DEBUG", "SLEEP", "0"],
      ["SUBSCRIBE", "c"],
      ["PUBLISH", "c", "m"],
      ["EXPIRE", "wren:k", "1"],
      ["INCR", "wren:n"],
      ["HSET", "wren:h", "f", "v"],
      // Redis 8 ships JSON, search, vector sets, time series and probabilistic types in core.
      ["JSON.SET", "wren:j", "$", "1"],
      ["FT._LIST"],
      ["VADD", "wren:v", "VALUES", "1", "1", "e"],
      ["TS.CREATE", "wren:t"],
      ["BF.ADD", "wren:b", "x"],
    ];
    for (const cmd of denied) {
      const err = await raw.send(...cmd).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, cmd.join(" ")).toBeInstanceOf(RespError);
      // DEBUG: refused before the ACL (enable-debug-command no).
      expect(String(err), cmd.join(" ")).toMatch(/NOPERM|DEBUG command not allowed/);
    }
    raw.close();
  }, 30_000);

  it("refuses a certificate that does not match its pin, and a wrong password", async () => {
    await ready();
    const wrongPin = respClient(url("00:11"));
    await expect(wrongPin.send("PING")).rejects.toThrow(/pin/);
    const wrongPw = respClient(url(fp, "nope"));
    await expect(wrongPw.send("PING")).rejects.toThrow(/WRONGPASS|invalid/);
    wrongPw.close();
    const plain = respClient(`redis://default:${PASSWORD}@localhost:${port}`, { timeoutMs: 2000 });
    await expect(plain.send("PING")).rejects.toThrow();
    plain.close();
  }, 30_000);

  it("drops the least recently used keys past 64 MB, and never refuses a SET", async () => {
    await ready();
    const c = slow();
    const mb = "y".repeat(1024 * 1024);
    for (let i = 0; i < 100; i++) await c.set(`lru${i}`, mb, 600_000);
    expect(await c.get("lru0")).toBeNull();
    expect(await c.get("lru99")).toBe(mb);
  }, 60_000);

  it("keeps nothing across a restart", async () => {
    await ready();
    const c = redisCache(url(fp));
    await c.set("kept", "1", 600_000);
    execFileSync("docker", ["restart", id]);
    port = hostPort();
    await ready();
    expect(await redisCache(url(fp)).get("kept")).toBeNull();
  }, 60_000);
});
