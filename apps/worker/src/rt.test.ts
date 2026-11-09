// The route list (designs/2026-11-09-own-runtime.md): the box lane and the renames name built
// services, and the runtime registers every one.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "@wren/config";
import { Registry } from "@wren/runtime/pg";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENAMED } from "./rt.js";
import { type AnyService, BOX_SERVICES, buildServices } from "./services.js";

let all: AnyService[] = [];
let close = async () => {};
beforeAll(async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "wren-rt-"));
  const settings = loadSettings(
    {
      WREN_DATABASE_URL: "postgres://wren:wren@127.0.0.1:1/wren",
      WREN_CONTENT_CHANNELS: "linkedin",
      WREN_NOTIFY: "console",
      WREN_PIXEL_BASE_URL: "https://pixel.example.test",
      WREN_PIXEL_EXPORT_TOKEN: "t",
      WREN_REPORT_TO: "r@example.test",
      WREN_REPORT_FROM: "f@example.test",
      WREN_PORTAL_ORIGIN: "https://app.example.test",
      // a gated loop, built so the route list may name it
      WREN_SITE_EXPORT_TOKEN: "t",
      WREN_GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
        type: "service_account",
        client_email: "sender@example.test",
        private_key: "synthetic",
      }),
    },
    { rootDir },
  );
  const quiet = () => {};
  const log = { info: quiet, warn: quiet, error: quiet, debug: quiet } as unknown as Logger;
  const built = await buildServices(settings, log, { rootDir });
  all = built.services;
  close = () => built.close();
}, 60_000);
afterAll(() => close());

describe("route list", () => {
  it("every box service is built", () => {
    const names = new Set(all.map((s) => s.name));
    expect(BOX_SERVICES.filter((s) => !names.has(s))).toEqual([]);
  });

  it("a rename goes from a name no service has to a built service", () => {
    const names = new Set(all.map((s) => s.name));
    for (const [from, to] of Object.entries(RENAMED)) {
      expect(names.has(from), from).toBe(false);
      expect(names.has(to), to).toBe(true);
    }
  });

  it("the runtime registers every built service, each name once", () => {
    const r = new Registry(all as never);
    expect(r.services.size).toBe(all.length);
  });
});
