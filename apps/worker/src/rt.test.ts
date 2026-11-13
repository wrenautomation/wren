// The route list (designs/2026-11-09-own-runtime.md): the box lane and the renames name built
// services, and the runtime registers every one.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, type Settings } from "@wren/config";
import { PORTAL_READS } from "@wren/portal-routes";
import { Registry } from "@wren/runtime/pg";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RENAMED } from "./rt.js";
import { type AnyService, BOX_SERVICES, buildServices } from "./services.js";

let all: AnyService[] = [];
let domainOf: ReadonlyMap<string, string> = new Map();
let close = async () => {};
let settings: Settings;
let rootDir = "";
const quiet = () => {};
const log = { info: quiet, warn: quiet, error: quiet, debug: quiet } as unknown as Logger;
beforeAll(async () => {
  rootDir = mkdtempSync(join(tmpdir(), "wren-rt-"));
  settings = loadSettings(
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
  const built = await buildServices(settings, log, { rootDir });
  all = built.services;
  domainOf = built.domainOf;
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

  it("every portal read is a built service's handler", () => {
    const r = new Registry(all as never);
    const missing = PORTAL_READS.filter((route) => {
      const [service = "", handler = ""] = route.split("/");
      return !r.get(service, handler);
    });
    expect(PORTAL_READS.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("the runtime registers every built service, each name once", () => {
    const r = new Registry(all as never);
    expect(r.services.size).toBe(all.length);
  });
});

describe("lazy domains (Lambda)", () => {
  it("every built service has a domain", () => {
    expect(all.filter((s) => !domainOf.has(s.name)).map((s) => s.name)).toEqual([]);
  });

  it("a turn loads its own domain; a wrong or missing domain loads all", async () => {
    const lazy = await buildServices(settings, log, { rootDir, lazy: true });
    try {
      expect(lazy.services).toEqual([]);
      const service = "LeadPoolFill";
      const domain = domainOf.get(service) as string;
      await lazy.need(service, domain);
      const one = all.filter((s) => domainOf.get(s.name) === domain).map((s) => s.name);
      expect(lazy.services.map((s) => s.name)).toEqual(one);
      // a service the named domain does not build (an old box, a moved service)
      const other = all.find((s) => domainOf.get(s.name) !== domain)?.name as string;
      await lazy.need(other, domain);
      expect(lazy.services.length).toBe(all.length);
    } finally {
      await lazy.close();
    }
  });
});
