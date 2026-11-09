// The route list (designs/2026-11-09-own-runtime.md, "Phase 3"): what a deploy flips must name
// built services, and both runtimes must take every service the worker builds.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "@wren/config";
import { Registry } from "@wren/runtime/pg";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_SERVICES, RENAMED, restateSide } from "./rt.js";
import { type AnyService, buildServices } from "./services.js";

type Def = { name: string; service?: object; object?: object };
const handlersOf = (d: Def) => Object.keys(d.service ?? d.object ?? {}).sort();

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
  it("every pg service is built, once", () => {
    const names = new Set(all.map((s) => s.name));
    expect(PG_SERVICES.filter((s) => !names.has(s))).toEqual([]);
    expect(new Set(PG_SERVICES).size).toBe(PG_SERVICES.length);
  });

  it("a rename goes from a name no service has to a pg service", () => {
    const names = new Set(all.map((s) => s.name));
    for (const [from, to] of Object.entries(RENAMED)) {
      expect(names.has(from), from).toBe(false);
      expect(PG_SERVICES, to).toContain(to);
    }
  });

  it("the pg runtime registers every built service", () => {
    const r = new Registry(all as never);
    expect(r.services.size).toBe(all.length);
  });

  it("Restate serves each pg service and each old name as a proxy with the same handlers", () => {
    const out = restateSide(all, () => {
      throw new Error("no database in this test");
    }) as unknown as Def[];
    const names = out.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(out.length).toBe(all.length + Object.keys(RENAMED).length);
    const byName = new Map((all as unknown as Def[]).map((s) => [s.name, s]));
    for (const d of out) {
      const target = byName.get(RENAMED[d.name] ?? d.name) as Def;
      expect(handlersOf(d), d.name).toEqual(handlersOf(target));
      const proxied = PG_SERVICES.includes(target.name);
      expect(d !== (target as unknown), d.name).toBe(proxied);
    }
  });
});
