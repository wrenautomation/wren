import type { FieldMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { recordHead } from "./record-head.js";

const f = (key: string, kind: FieldMeta["kind"], more: Partial<FieldMeta> = {}): FieldMeta =>
  ({
    key,
    kind,
    label: key,
    ops: [],
    sortable: false,
    searchable: false,
    column: { align: "start", width: "m" },
    ...more,
  }) as FieldMeta;

const meta = {
  title: "name",
  subtitle: "blurb",
  fields: [
    f("name", "text"),
    f("blurb", "text"),
    f("stage", "status"),
    f("domain", "text"),
    f("missing", "text"),
    f("icon", "text", { group: "System" }),
    f("notes", "text", { column: null }),
  ],
};
const none = () => false;

describe("recordHead", () => {
  it("names the subtitle, the states and the short key facts as shown", () => {
    const h = recordHead(
      meta,
      {
        name: "Acme",
        blurb: "One line.",
        stage: "lead",
        domain: "acme.example",
        missing: "x".repeat(40),
        icon: "flag",
        notes: "n",
      },
      none,
    );
    expect(h.sub?.key).toBe("blurb");
    expect(h.states.map((x) => x.key)).toEqual(["stage"]);
    // Long text wraps in the Details, not as a truncated stat; System and non-columns stay below.
    expect(h.keys.map((x) => x.key)).toEqual(["domain"]);
    expect([...h.shown].sort()).toEqual(["blurb", "domain", "stage"]);
  });

  it("keeps a long subtitle in the Details too", () => {
    const h = recordHead(meta, { name: "Acme", blurb: "y".repeat(200) }, none);
    expect(h.sub?.key).toBe("blurb");
    expect(h.shown.has("blurb")).toBe(false);
  });
  it("measures tags by their labels: two long ones wrap in the Details, not a key fact", () => {
    const effects = f("effects", "tags", {
      states: {
        sends: { label: "Sends messages", tone: "neutral" },
        spends: { label: "Spends money", tone: "neutral" },
        posts: { label: "Posts publicly", tone: "neutral" },
      },
    } as Partial<FieldMeta>);
    const m = { ...meta, fields: [...meta.fields, effects] };
    expect(recordHead(m, { name: "A", effects: "sends" }, none).keys.map((x) => x.key)).toContain(
      "effects",
    );
    expect(
      recordHead(m, { name: "A", effects: "sends,spends,posts" }, none).keys.map((x) => x.key),
    ).not.toContain("effects");
  });
});
