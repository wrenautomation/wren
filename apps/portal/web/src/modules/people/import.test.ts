// The Import page: it reads the record the service declares, is a client's own, and its plain
// lines say what the server counted.

import { PORTAL_APPS, PORTAL_ROUTES } from "@wren/reactivation/portal-routes";
import { importLog } from "@wren/reactivation/records";
import { describe, expect, it } from "vitest";
import type { ImportPreview, ImportResult } from "../../api.js";
import {
  base64Of,
  LIMITS,
  MAIN_FIELDS,
  previewLines,
  resultLine,
  tooBig,
  whyLine,
  willLoad,
} from "./import-form.js";

// The page's api module reads the address as it loads; a bare one does here.
Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { importPage } = await import("./import.js");
const { clientPeople, people } = await import("./index.js");

const preview = (more: Partial<ImportPreview> = {}): ImportPreview => ({
  format: "crm-generic",
  formats: [],
  headers: [],
  columns: {},
  fields: [],
  rows: 12,
  missing: [],
  skipped: 2,
  why: [],
  noEmail: 0,
  badEmail: 0,
  sample: [],
  seen: null,
  ...more,
});

describe("import page", () => {
  it("reads the record the service declares, in the app the routes answer to", () => {
    expect(importPage.record).toBe(importLog.id);
    const fields = Object.keys(importLog.fields);
    for (const c of importPage.columns ?? []) expect(fields, c).toContain(c);
    const views = (importLog.views ?? []).map((v) => v.id);
    expect(Object.keys(importPage.empty as object).sort()).toEqual([...views].sort());
    expect(importLog.app).toBe("people");
    expect(PORTAL_APPS.importRun).toBe("people");
    expect(importPage.requires?.needs).toBe(PORTAL_ROUTES.importRun);
  });

  it("is a client's own: not on the demo, and not in Wren's own people", () => {
    expect(importPage.requires?.audience).toBe("client");
    expect(clientPeople.pages).toContain(importPage);
    expect(people.pages).not.toContain(importPage);
  });

  it("shows nothing in its head on the demo", () => {
    const at = { client: "acme", demo: true, team: false, params: new URLSearchParams() };
    expect(importPage.head?.({} as never, () => {}, at)).toBeNull();
  });
});

describe("import lines", () => {
  it("counts what will load, and what will be left out", () => {
    expect(willLoad(preview())).toBe(10);
    expect(previewLines(preview())).toEqual([
      "12 rows in the file. 10 will load and 2 will be left out.",
    ]);
    expect(previewLines(preview({ rows: 1, skipped: 0 }))).toEqual([
      "1 row in the file. 1 will load.",
    ]);
  });

  it("says what to know about the people that load", () => {
    const lines = previewLines(preview({ noEmail: 1, badEmail: 3, seen: 7 }));
    expect(lines).toContain("1 person with no email.");
    expect(lines).toContain("3 people with an email that looks wrong. They still load.");
    expect(lines).toContain("You loaded this file before (import 7). Loading it again merges.");
  });

  it("says how a load went", () => {
    const r: ImportResult = {
      id: 3,
      rows: 1500,
      created: 1200,
      merged: 298,
      skipped: 2,
      why: [],
      noEmail: 0,
      badEmail: 0,
      seen: null,
    };
    expect(resultLine(r)).toBe("1,200 new, 298 merged, 2 skipped.");
    expect(whyLine({ reason: "no name", n: 2 })).toBe("no name (2)");
  });

  it("sends a big file as base64 whole, and stops one over the limit", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(Buffer.from(base64Of(bytes), "base64").equals(Buffer.from(bytes))).toBe(true);
    expect(tooBig(LIMITS.bytes)).toBeNull();
    expect(tooBig(LIMITS.bytes + 1)).toContain("Split it");
  });

  it("keeps the common columns up front", () => {
    expect(MAIN_FIELDS).toContain("email");
    expect(MAIN_FIELDS).not.toContain("owner");
  });
});
