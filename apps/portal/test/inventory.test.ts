// Node, not the Worker: type-checked by scripts/tsconfig.json.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "@wren/config";
import { APPS, isChannel, isNeed, routeAt } from "@wren/core/access";
import { DECLARED } from "@wren/core/records";
import { buildServices } from "@wren/worker/services";
import { afterAll, describe, expect, it } from "vitest";
import { SERVICES } from "../src/services.js";

const quiet = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Parameters<
  typeof buildServices
>[1];
const rootDir = mkdtempSync(join(tmpdir(), "wren-inventory-"));
// From env alone: no database is reached.
const settings = loadSettings(
  { WREN_DATABASE_URL: "postgres://wren:wren@127.0.0.1:1/wren" },
  { rootDir },
);
const built = await buildServices(settings, quiet, { rootDir });
afterAll(() => built.close());

/** Every portal route declares a need, and the map is exactly what the service serves. */
describe("every portal route has a permission", () => {
  for (const [path, svc] of Object.entries(SERVICES))
    it(`/api/${path} → ${svc.name}`, () => {
      const served = built.services.find((s) => s.name === svc.name);
      expect(served, `${svc.name} isn't bound by the worker`).toBeDefined();
      const handlers = Object.keys((served as unknown as { service: object }).service);
      expect([...svc.routes].sort()).toEqual(handlers.sort());
      for (const [route, need] of Object.entries(svc.needs))
        expect(isNeed(need), `${svc.name}/${route}`).toBe(true);
      for (const w of svc.writes) expect(svc.routes.has(w), `${svc.name}/${w}`).toBe(true);
    });
});

/** Every route works in a known app (or the handler checks), on a known channel. */
describe("every portal route has a place", () => {
  for (const [path, svc] of Object.entries(SERVICES))
    it(`/api/${path}`, () => {
      for (const route of svc.routes) {
        const at = routeAt(svc.apps, route);
        if (at.app !== undefined) expect(Object.keys(APPS), `${path}/${route}`).toContain(at.app);
        if (at.channel !== undefined) expect(isChannel(at.channel), `${path}/${route}`).toBe(true);
      }
      for (const k of Object.keys(svc.apps))
        if (k !== "*") expect(svc.routes.has(k), `${path}: no route ${k}`).toBe(true);
    });
});

/** Every record type the worker serves says its app and channel (designs/2026-10-06-scoped-access.md). */
describe("every record type has an app and a channel", () => {
  it("declares both", () => {
    expect(DECLARED.size).toBeGreaterThan(50);
    for (const [id, { app, channel }] of DECLARED) {
      expect(Object.keys(APPS), id).toContain(app);
      expect(
        channel === null || isChannel(channel) || (typeof channel === "object" && !!channel.field),
        id,
      ).toBe(true);
    }
  });
});
