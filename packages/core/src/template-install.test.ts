import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineComponent } from "./components.js";
import { installCheck } from "./installs.js";
import type { WorkflowInstall } from "./schema.js";
import {
  confirmed,
  copyLabel,
  copyRefs,
  type Plan,
  planOf,
  type Template,
  templateNamed,
  templatesOf,
} from "./template-install.js";
import { parseRef } from "./templates.js";
import { checkWorkflows, defineWorkflow } from "./workflows.js";

const hypothesis = { from: "a test", guesses: [{ is: "fixed" as const, says: "x" }] };
const base = {
  blurb: "x",
  icon: "mail",
  for: "client" as const,
  stage: "reach" as const,
  ready: true,
  hypothesis,
};
const texts = defineComponent({
  ...base,
  id: "texts",
  name: "Texts",
  requires: { accounts: ["telnyx"] },
  in: [{ id: "forms", label: "forms", kind: "lead" }],
  provides: { templates: ["sms:texts/hello#1"] },
});
const door = defineComponent({
  ...base,
  id: "door",
  name: "Door",
  inside: "flow",
  comesWith: "door",
  effects: ["sends"],
  settings: z.object({ wait: z.number().optional() }).strict(),
  requires: { components: ["texts"] },
  in: [{ id: "forms", label: "forms", kind: "lead" }],
  provides: { templates: ["sms:texts/door#1"] },
});
const soon = defineComponent({ ...base, id: "soon", name: "Soon", ready: false, planned: true });
const COMPONENTS = [texts, door, soon];
const flow = defineWorkflow({
  ...base,
  id: "flow",
  name: "Flow",
  in: [{ id: "forms", label: "forms", kind: "lead" }],
  nodes: [{ id: "d", uses: "texts" }],
  wires: [{ from: "in.forms", to: "d.forms", via: "events" }],
  template: {
    parts: { texts: {}, door: { wait: 5 }, soon: {} },
    door: { input: "forms", subject: "phone" },
  },
});
const [T] = templatesOf([flow], COMPONENTS) as [Template];
const FILES = [{ ref: parseRef("sms:texts/hello#1"), source: "hi", hash: "h" }];
const client = { id: "c1", products: {} as Record<string, unknown>, accounts: {} };
const row = (over: Partial<WorkflowInstall>): WorkflowInstall => ({
  id: 1,
  client: "c1",
  template: "door",
  workflow: "flow",
  version: T.version,
  state: "draft",
  applied: { added: ["texts", "door"], blocks: { texts: {}, door: { wait: 5 } }, copy: [] },
  hook: "00000000-0000-0000-0000-000000000000",
  by: "test",
  at: new Date(),
  askedBy: null,
  askedAt: null,
  approvedBy: null,
  approvedAt: null,
  removedBy: null,
  removedAt: null,
  ...over,
});
const plan = (now: Partial<Parameters<typeof planOf>[1]>): Plan =>
  planOf(T, { client, row: null, copy: [], saves: [], files: FILES, ...now });
const statuses = (p: Plan) => Object.fromEntries(p.parts.map((x) => [x.id, x.status]));

describe("templatesOf", () => {
  it("names a template after the part whose inside it is, and finds it by either id", () => {
    expect(T.id).toBe("door");
    expect(T.name).toBe("Door");
    expect(T.copy).toEqual(["sms:texts/hello#1", "sms:texts/door#1"]);
    expect(T.effects).toEqual(["sends"]);
    expect(templateNamed([T], "flow")).toBe(T);
    expect(() => templateNamed([T], "nope")).toThrow("no such template");
  });

  it("checks a template's parts: known, listed after what they need, settings that parse", () => {
    const bad = defineWorkflow({
      ...flow,
      template: {
        parts: { door: { wait: "x" }, ghost: {} },
        door: { input: "nope", subject: "p" },
      },
    });
    expect(checkWorkflows([bad], COMPONENTS)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ghost"),
        expect.stringContaining("texts"),
        expect.stringContaining("nope"),
      ]),
    );
    expect(checkWorkflows([flow], COMPONENTS)).toEqual([]);
  });
});

describe("planOf", () => {
  it("plans a new install: parts, copy, a draft and a shut door, confirm by the template's name", () => {
    const p = plan({});
    expect(p.kind).toBe("new");
    expect(statuses(p)).toEqual({ texts: "add", door: "add", soon: "development" });
    expect(p.parts.find((x) => x.id === "door")?.settings).toEqual({ wait: 5 });
    expect(p.parts.find((x) => x.id === "texts")?.accounts.map((a) => a.site)).toEqual(["telnyx"]);
    expect(p.copy).toEqual([
      { ref: "sms:texts/hello#1", status: "add" },
      { ref: "sms:texts/door#1", status: "none" },
    ]);
    expect(p.draft).toBe("add");
    expect(p.door).toEqual({ status: "add", input: "forms", subject: "phone" });
    expect(p.confirm).toBe("Door");
  });

  it("takes the name or the id as typed, case and spaces aside", () => {
    expect(confirmed(T, " door ")).toBe(true);
    expect(confirmed({ id: "speed_to_lead", name: "Speed to lead" }, "speed  TO lead")).toBe(true);
    expect(confirmed(T, "dor")).toBe(false);
    expect(confirmed(T, undefined)).toBe(false);
  });

  it("finds nothing to do when it's all there as the template has it", () => {
    const p = plan({
      client: { ...client, products: { texts: {}, door: { wait: 5 } } },
      row: row({}),
      copy: [{ ref: "sms:texts/hello#1", followsDefault: true, live: true }],
      saves: [{ live: false, edits: null }],
    });
    expect(p.kind).toBe("same");
    expect(p.changes).toBe(0);
    expect(p.confirm).toBeNull();
    expect(statuses(p)).toEqual({ texts: "same", door: "same", soon: "development" });
    expect(p.copy[0]?.status).toBe("have");
  });

  it("keeps what the client changed: settings, words, draft", () => {
    const p = plan({
      client: { ...client, products: { texts: {}, door: { wait: 9 } } },
      row: row({}),
      copy: [{ ref: "sms:texts/hello#1", followsDefault: false, live: true }],
      saves: [{ live: false, edits: { nodes: [], wires: [] } as never }],
    });
    expect(statuses(p).door).toBe("kept");
    expect(p.copy[0]?.status).toBe("own");
    expect(p.draft).toBe("edited");
    expect(p.kind).toBe("same");
  });

  it("leaves a part the client had before alone", () => {
    const p = plan({ client: { ...client, products: { texts: { x: 1 } } } });
    expect(statuses(p).texts).toBe("have");
    expect(p.parts.find((x) => x.id === "texts")?.settings).toBeNull();
  });

  it("calls a template that moved an update, and says what changes", () => {
    const moved = plan({
      client: { ...client, products: { texts: {}, door: { wait: 5 } } },
      row: row({
        version: "old",
        applied: { added: ["texts", "door"], blocks: { texts: {}, door: { wait: 2 } }, copy: [] },
      }),
      saves: [{ live: true, edits: null }],
    });
    // The block is the client's (it differs from what was written), so it's kept, not updated.
    expect(statuses(moved).door).toBe("kept");
    expect(moved.kind).toBe("update");
    expect(moved.draft).toBe("live");
    const ours = plan({
      client: { ...client, products: { texts: {}, door: { wait: 2 } } },
      row: row({
        version: "old",
        applied: { added: ["texts", "door"], blocks: { texts: {}, door: { wait: 2 } }, copy: [] },
      }),
      saves: [{ live: true, edits: null }],
    });
    expect(statuses(ours).door).toBe("update");
    expect(ours.parts.find((x) => x.id === "door")?.settings).toEqual({ wait: 5 });
  });

  it("puts parts back with the settings they had after an uninstall", () => {
    const p = plan({
      row: row({
        state: "off",
        applied: {
          added: ["texts", "door"],
          blocks: { texts: {}, door: { wait: 5 } },
          copy: [],
          kept: { door: { wait: 7 } },
        },
      }),
      saves: [{ live: true, edits: null }],
    });
    expect(p.kind).toBe("back");
    expect(statuses(p)).toEqual({ texts: "back", door: "back", soon: "development" });
    expect(p.parts.find((x) => x.id === "door")?.settings).toEqual({ wait: 7 });
    expect(p.door?.status).toBe("have");
  });
});

describe("facts", () => {
  it("says a fact a part needs and the client lacks as a needed account, with its setup step", () => {
    const needy = defineComponent({ ...texts, requires: { accounts: [], facts: ["sms.ready"] } });
    const [t] = templatesOf([flow], [needy, door, soon]) as [Template];
    const setups = [
      {
        id: "setup.sms",
        name: "Texting",
        blurb: "x",
        site: "number" as const,
        steps: [
          {
            id: "ready",
            fact: "sms.ready",
            label: "Number ready",
            who: "wren" as const,
            how: "Wait for it.",
            forYou: "Wren buys it.",
          },
        ],
      },
    ];
    const at = (facts: Set<string>) =>
      planOf(t, { client, row: null, copy: [], saves: [], files: FILES, facts, setups }).parts[0];
    expect(at(new Set())?.accounts).toEqual([
      {
        site: "sms.ready",
        label: "Number ready",
        how: "Wait for it.",
        waits: "Wren buys it.",
        setup: "Texting",
      },
    ]);
    expect(at(new Set(["sms.ready"]))?.accounts).toEqual([]);
  });
});

describe("installCheck", () => {
  it("installs a part that comes with a template only through it, and waits on accounts there", () => {
    expect(() =>
      installCheck(door, { products: { texts: {} }, accounts: {} }, { confirm: "door" }),
    ).toThrow("comes with the door template");
    expect(() => installCheck(texts, client, {})).toThrow("needs first: telnyx");
    expect(installCheck(texts, client, { template: "door" })).toEqual({});
    expect(() =>
      installCheck(door, { products: {}, accounts: {} }, { template: "door", confirm: "door" }),
    ).toThrow("needs first: texts");
    expect(() =>
      installCheck(
        door,
        { products: { texts: {} }, accounts: {} },
        { template: "door", confirm: "x" },
      ),
    ).toThrow("type door to confirm");
    expect(
      installCheck(
        door,
        { products: { texts: {} }, accounts: {} },
        {
          template: "door",
          confirm: "door",
          settings: { wait: 5 },
        },
      ),
    ).toEqual({ wait: 5 });
  });
});

describe("copy", () => {
  it("opens prefixes over the defaults and keeps exact refs with or without a file", () => {
    expect(copyRefs(["sms:texts/", "sms:texts/door#1"], FILES)).toEqual([
      { ref: "sms:texts/hello#1", file: true },
      { ref: "sms:texts/door#1", file: false },
    ]);
  });

  it("reads a ref as a name", () => {
    expect(copyLabel("sms:texts/speed-to-lead#2")).toBe("Speed to lead text 2");
    expect(copyLabel("prompt:reactivation/compose")).toBe("Compose prompt");
  });
});
