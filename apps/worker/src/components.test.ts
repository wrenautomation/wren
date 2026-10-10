/**
 * The inventory: every service the worker binds, and every record type, is in
 * exactly one component or the platform, and every component says what it needs.
 * A new service or record with no component fails here. Portal apps are checked
 * beside the modules (`apps/portal/web/src/modules/components.test.ts`).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOKS_RECORDS } from "@wren/books/records";
import { CALENDAR_RECORDS } from "@wren/calendar/records";
import { emailRecords } from "@wren/channel-email/records";
import type { SendPolicy } from "@wren/channel-email/send/policy";
import { heatRecord, sessionRecord, surveyAnswerRecord } from "@wren/channel-search/records";
import { textCopyRecord } from "@wren/channel-sms/records";
import { loadSettings } from "@wren/config";
import { videoRecord } from "@wren/content/records";
import { askRecord } from "@wren/core/ask";
import { type Client, changeRecord, clientRecord, teamRecord } from "@wren/core/clients";
import { ACCOUNT_SITES } from "@wren/core/components";
import {
  componentRecord,
  eventRecord,
  executionRecord,
  handlerRecord,
  loopRecord,
} from "@wren/core/console";
import { HOOK_PRESETS } from "@wren/core/door";
import { MARKETING_RECORDS } from "@wren/core/marketing/records";
import { defaultFile } from "@wren/core/templates/defaults";
import { templatesOf } from "@wren/core/templates/install";
import { checkWorkflows } from "@wren/core/workflows";
import type { Queryable } from "@wren/db";
import { DEALS_RECORDS } from "@wren/deals/records";
import { HEALTH_RECORDS } from "@wren/delivery/health";
import { deliveryRecords } from "@wren/delivery/records";
import { DOCUMENTS_RECORDS } from "@wren/documents/records";
import { LEARN_RECORDS, sopRecordFor } from "@wren/learn/records";
import { NICHES } from "@wren/niches";
import { dmCopyRecord } from "@wren/outreach/records";
import { PAYMENTS_RECORDS } from "@wren/payments/records";
import { REACTIVATION_RECORDS, settingOf } from "@wren/reactivation/records";
import { SITES_RECORDS } from "@wren/sites/records";
import { VOICE_RECORDS } from "@wren/voice/records";
import { WATCH_RECORDS } from "@wren/watch/records";
import type { Logger } from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { COMPONENTS, PLATFORM } from "./components.js";
import { MARKETING_NUMBERS } from "./marketing.js";
import { reviewRecord } from "./review.js";
import { buildServices } from "./services.js";
import { WORKFLOWS } from "./workflows.js";

const quiet = () => {};
const log = { info: quiet, warn: quiet, error: quiet, debug: quiet } as unknown as Logger;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  while (closers.length) await closers.pop()?.();
});

/** Every service and its handlers, from an env that turns on all but Postmaster (no database reached). */
async function bound() {
  const rootDir = mkdtempSync(join(tmpdir(), "wren-components-"));
  const settings = loadSettings(
    {
      WREN_DATABASE_URL: "postgres://wren:wren@127.0.0.1:1/wren",
      WREN_SEARCH_SITE: "sc-domain:example.test",
      WREN_SEARCH_ORIGIN: "https://example.test",
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
  const built = await buildServices(settings, log, { rootDir });
  closers.push(() => built.close());
  return new Map(
    (
      built.services as unknown as {
        name: string;
        service?: object;
        object?: object;
        workflow?: object;
      }[]
    ).map((d) => [d.name, Object.keys(d.service ?? d.object ?? d.workflow ?? {})]),
  );
}

/** Every record type the worker serves, built without a database. */
const RECORD_TYPES = [
  ...emailRecords([], {} as SendPolicy),
  ...BOOKS_RECORDS,
  ...WATCH_RECORDS,
  ...LEARN_RECORDS,
  sopRecordFor(null),
  ...SITES_RECORDS,
  ...PAYMENTS_RECORDS,
  ...DOCUMENTS_RECORDS,
  ...DEALS_RECORDS,
  ...CALENDAR_RECORDS,
  ...VOICE_RECORDS,
  ...MARKETING_NUMBERS,
  sessionRecord({ site: { baseUrl: "", exportToken: "" }, signGet: async () => "" }),
  surveyAnswerRecord({ baseUrl: "", exportToken: "" }),
  heatRecord(),
  videoRecord(),
  dmCopyRecord("x"),
  textCopyRecord([], "x"),
  clientRecord,
  ...HEALTH_RECORDS,
  teamRecord,
  changeRecord,
  loopRecord(async () => []),
  eventRecord,
  executionRecord,
  handlerRecord(async () => ({})),
  componentRecord([], null, false),
  ...deliveryRecords({} as Queryable, "synthetic", true),
  ...REACTIVATION_RECORDS,
  ...MARKETING_RECORDS,
  settingOf({} as Client),
  reviewRecord(),
  askRecord,
];
const RECORDS = RECORD_TYPES.map((t) => t.id);

/** Who claims each name in `pick`, platform first. */
function owners(pick: (c: (typeof COMPONENTS)[number]) => string[], platform: object) {
  const by = new Map<string, string[]>(Object.keys(platform).map((k) => [k, ["platform"]]));
  for (const c of COMPONENTS) for (const n of pick(c)) by.set(n, [...(by.get(n) ?? []), c.id]);
  return by;
}

describe("the component inventory", () => {
  it("has one component per id", () => {
    const ids = COMPONENTS.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("every bound service is in exactly one component or the platform", async () => {
    const services = await bound();
    const by = owners((c) => c.provides.services, PLATFORM.services);
    const wrong = [...services.keys()]
      .map((s) => [s, by.get(s) ?? []] as const)
      .filter(([, o]) => o.length !== 1);
    expect(wrong).toEqual([]);
  });

  it("every provided service is bound, but Postmaster, which needs its own login", async () => {
    const services = await bound();
    const unbound = COMPONENTS.flatMap((c) => c.provides.services).filter((s) => !services.has(s));
    expect(unbound).toEqual(["PostmasterScheduler"]);
  });

  it("a loop is one of its component's services, and has a `loop` handler", async () => {
    const services = await bound();
    for (const c of COMPONENTS)
      for (const l of c.provides.loops) {
        expect(c.provides.services, `${c.id} ${l}`).toContain(l);
        if (services.has(l)) expect(services.get(l), l).toContain("loop");
      }
    const loops = [...services].filter(([, h]) => h.includes("loop")).map(([s]) => s);
    const claimed = COMPONENTS.flatMap((c) => c.provides.loops);
    expect(loops.filter((l) => !claimed.includes(l) && !(l in PLATFORM.services))).toEqual([]);
  });

  it("every record type is in exactly one component or the platform", () => {
    const by = owners((c) => c.provides.records, PLATFORM.records);
    const wrong = RECORDS.map((r) => [r, by.get(r) ?? []] as const).filter(
      ([, o]) => o.length !== 1,
    );
    expect(wrong).toEqual([]);
    const unserved = [...by.keys()].filter((r) => !RECORDS.includes(r));
    expect(unserved).toEqual([]);
  });

  it("every requires names a real component or account site", () => {
    const ids = new Set(COMPONENTS.map((c) => c.id));
    for (const c of COMPONENTS) {
      for (const r of c.requires.components) expect(ids.has(r), `${c.id} needs ${r}`).toBe(true);
      for (const a of [...c.requires.accounts, ...c.requires.anyAccount])
        expect(ACCOUNT_SITES, c.id).toContain(a);
    }
  });

  it("not ready says what's missing; ready says nothing is", () => {
    for (const c of COMPONENTS) expect(c.missing.length > 0, c.id).toBe(!c.ready);
  });

  it("every settings block takes {}", () => {
    for (const c of COMPONENTS) expect(c.settings.safeParse({}).success, c.id).toBe(true);
  });
});

describe("workflows and hypotheses", () => {
  it("every workflow wires real ports of matching kinds", () => {
    expect(checkWorkflows(WORKFLOWS, COMPONENTS)).toEqual([]);
  });

  it("a port's count is a served record's view that counts by date", () => {
    for (const p of [...COMPONENTS, ...WORKFLOWS])
      for (const port of [...p.in, ...p.out]) {
        if (!port.count) continue;
        const { record, view } = port.count;
        const v = RECORD_TYPES.find((t) => t.id === record)?.views.find((x) => x.id === view);
        expect(v?.at, `${p.id}.${port.id}: ${record}/${view}`).toBeTruthy();
      }
  });

  it("every part has a hypothesis, and what it says is built is there", () => {
    const ids = new Set(COMPONENTS.map((c) => c.id));
    const niche = new Set(NICHES.flatMap((n) => Object.keys(n)));
    for (const c of COMPONENTS) {
      expect(c.hypothesis.from, c.id).not.toBe("");
      expect(c.hypothesis.guesses.length, c.id).toBeGreaterThan(0);
      const settings = Object.keys((c.settings as { shape?: object }).shape ?? {});
      for (const g of c.hypothesis.guesses) {
        // Prose (with spaces) names something outside the code; a bare ref must resolve.
        if (g.is === "fixed" || !g.built || /\s/.test(g.built)) continue;
        const [head, ...rest] = g.built.split(".");
        const key = rest.join(".");
        const found =
          g.built === "inside"
            ? c.inside !== null
            : head === "settings"
              ? settings.includes(key)
              : head === "niche"
                ? niche.has(key)
                : head === "in" || head === "out"
                  ? c[head].some((p) => p.id === key)
                  : ids.has(g.built);
        expect(found, `${c.id}: ${g.built}`).toBe(true);
      }
    }
  });

  it("every hook preset enters a real workflow input", () => {
    for (const [name, p] of Object.entries(HOOK_PRESETS)) {
      const f = WORKFLOWS.find((w) => w.id === p.workflow);
      expect(f?.in.map((i) => i.id) ?? [], name).toContain(p.input);
    }
  });

  it("speed to lead and win back install as templates", () => {
    const sold = templatesOf(WORKFLOWS, COMPONENTS);
    expect(sold.map((t) => t.id)).toEqual(expect.arrayContaining(["speed_to_lead", "win_back"]));
    const speed = sold.find((t) => t.id === "speed_to_lead");
    // Its four parts run per client now; each installs only with it.
    for (const id of ["speed_to_lead", "sms.forms", "sms.follow_up", "voice.call_now"]) {
      const c = COMPONENTS.find((x) => x.id === id);
      expect(c?.ready, id).toBe(true);
      expect(c?.comesWith, id).toBe("speed_to_lead");
      expect(
        speed?.parts.some((p) => p.part.id === id),
        id,
      ).toBe(true);
    }
    expect(speed?.spec.door).toEqual({ input: "forms", subject: "phone" });
  });

  it("missed-call text back and review requests install as templates, with their copy", () => {
    const sold = templatesOf(WORKFLOWS, COMPONENTS);
    for (const [id, parts, fact] of [
      ["missed_call", ["missed_call", "sms.text_back", "sms.texts"], "number.calls_routed"],
      ["reviews", ["reviews", "reviews.ask", "sms.texts"], "google_business.place_id"],
    ] as const) {
      const t = sold.find((x) => x.id === id);
      expect(t?.parts.map((p) => p.part.id).sort(), id).toEqual([...parts].sort());
      const top = COMPONENTS.find((x) => x.id === id);
      // Needs setup until its fact holds.
      expect(top?.requires.facts, id).toEqual([fact]);
      for (const p of t?.parts ?? [])
        for (const ref of p.part.provides.templates) {
          const [kind = "", rest = ""] = ref.split(":");
          const [system = "", ...name] = rest.split("/");
          expect(
            defaultFile({ kind: kind as "sms", system, name: name.join("/") }),
            ref,
          ).not.toBeNull();
        }
    }
    expect(sold.find((x) => x.id === "reviews")?.spec.door).toEqual({
      input: "customers",
      subject: "phone|email",
    });
  });

  it("a part's later steps are parts still in development", () => {
    for (const c of COMPONENTS)
      for (const id of c.later)
        expect(COMPONENTS.find((x) => x.id === id)?.planned, `${c.id} later ${id}`).toBe(true);
  });

  it("follow-up and nurture ship every copy their touches send, as default files", () => {
    for (const id of ["follow_up", "nurture"]) {
      const c = COMPONENTS.find((x) => x.id === id);
      expect(c?.planned, id).toBe(false);
      expect(c?.provides.templates.length, id).toBeGreaterThan(0);
      for (const ref of c?.provides.templates ?? []) {
        const [kind = "", rest = ""] = ref.split(":");
        const [system = "", ...name] = rest.split("/");
        expect(
          defaultFile({ kind: kind as "sms", system, name: name.join("/") }),
          ref,
        ).not.toBeNull();
      }
    }
  });

  it("a part in development is never ready and runs nothing yet", () => {
    for (const c of COMPONENTS.filter((x) => x.planned)) {
      expect(c.ready, c.id).toBe(false);
      // A scaffold may show its app, records and test buttons (the voice agent); no loop runs.
      expect(c.provides.loops, c.id).toEqual([]);
    }
  });
});
