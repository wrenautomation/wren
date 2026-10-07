import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type Action,
  applies,
  blockedOf,
  type FormField,
  inputOf,
  runs,
  typedOf,
  valuesOf,
} from "./action.js";
import { HandlerForm } from "./handler.js";

const PAUSE: Action = {
  id: "pause",
  label: "Pause",
  handler: "email/pause",
  ask: { field: "reason", label: "Why?" },
};
const STOP: Action = { id: "stop", label: "Stop", handler: "console/stopLoop" };

describe("inputOf", () => {
  it("sends the asked text only when it changed", () => {
    const APPROVE: Action = { ...PAUSE, ask: { field: "body", label: "Reply" } };
    expect(inputOf(PAUSE, { target: "a@x.test" }, "  bounced  ")).toEqual({
      target: "a@x.test",
      reason: "bounced",
    });
    expect(inputOf(PAUSE, { target: "a@x.test" }, " ")).toEqual({ target: "a@x.test" });
    expect(inputOf(APPROVE, { id: 4, body: "Tuesday works." }, "Tuesday works.\n")).toEqual({
      id: 4,
    });
    expect(inputOf(APPROVE, { id: 4, body: "Tuesday works." }, "Wednesday?")).toEqual({
      id: 4,
      body: "Wednesday?",
    });
    expect(inputOf(STOP, { key: "k" }, "")).toEqual({ key: "k" });
  });
});

describe("form actions", () => {
  const ADD: Action = {
    id: "add",
    label: "Add",
    handler: "console/addClient",
    form: [
      { field: "name", label: "Name" },
      { field: "id", label: "Short name", from: ({ name = "" }) => name.toLowerCase() },
    ],
  };
  it("fills a field from the ones before it until it's typed over", () => {
    const form = ADD.form ?? [];
    expect(valuesOf(form, { name: "Acme" })).toEqual({ name: "Acme", id: "acme" });
    expect(valuesOf(form, { name: "Acme", id: "ac" })).toEqual({ name: "Acme", id: "ac" });
    expect(valuesOf(form, {})).toEqual({ name: "", id: "" });
  });
  it("applies to no row, unless asked on each", () => {
    expect(applies(ADD, { id: "x" })).toBe(false);
    expect(applies(STOP, { id: "x" })).toBe(true);
    const SLIP: Action = { ...ADD, each: true, when: { state: ["now"] } };
    expect(applies(SLIP, { state: "now" })).toBe(true);
    expect(applies(SLIP, { state: "done" })).toBe(false);
  });
  it("applies but won't run on a blocked row, and says why", () => {
    const APPROVE: Action = {
      id: "approve",
      label: "Approve",
      handler: "x/approve",
      when: { state: ["draft"] },
      blocked: { format: { carousel: "Carousels can't post yet." } },
    };
    const carousel = { state: "draft", format: "carousel" };
    expect(applies(APPROVE, carousel)).toBe(true);
    expect(runs(APPROVE, carousel)).toBe(false);
    expect(blockedOf(APPROVE, carousel)).toBe("Carousels can't post yet.");
    expect(runs(APPROVE, { state: "draft", format: "post" })).toBe(true);
    expect(blockedOf(APPROVE, { state: "draft" })).toBeNull();
  });
  it("leaves a file out of the typed values", () => {
    expect(valuesOf([{ field: "file", label: "File", type: "file" }], {})).toEqual({});
  });
});

describe("typedOf: a form's text as the input it sends", () => {
  const FORM: FormField[] = [
    { field: "day", label: "Day", type: "date" },
    { field: "note", label: "Note", optional: true },
    { field: "limit", label: "Limit", type: "number", optional: true },
    { field: "dryRun", label: "Dry run", type: "switch" },
    { field: "ids", label: "Ids", type: "lines", optional: true },
    { field: "personIds", label: "Person ids", type: "numbers", optional: true },
    { field: "recheck.olderThanDays", label: "Recheck.Days", type: "number", optional: true },
    { field: "extra", label: "Extra", type: "json", optional: true },
  ];

  it("types each box and nests parent.child", () => {
    const typed = {
      day: "2026-01-02",
      limit: "5",
      dryRun: "true",
      ids: "a\n  b \n\n",
      personIds: "1\n2",
      "recheck.olderThanDays": "30",
      extra: '{"x":[1]}',
    };
    expect(typedOf(FORM, valuesOf(FORM, typed))).toEqual({
      day: "2026-01-02",
      limit: 5,
      dryRun: true,
      ids: ["a", "b"],
      personIds: [1, 2],
      recheck: { olderThanDays: 30 },
      extra: { x: [1] },
    });
  });

  it("leaves an empty optional box out; an untouched required switch is off", () => {
    expect(typedOf(FORM, valuesOf(FORM, { day: "2026-01-02" }))).toEqual({
      day: "2026-01-02",
      dryRun: false,
    });
  });

  it("names the box when its text is no number or no JSON", () => {
    expect(() => typedOf(FORM, { limit: "five" })).toThrow("Limit: not a number");
    expect(() => typedOf(FORM, { personIds: "1\nx" })).toThrow("Person ids: x is not a number");
    expect(() => typedOf(FORM, { extra: "{" })).toThrow("Extra: not JSON");
  });

  it("sends a text form as typed", () => {
    const form: FormField[] = [
      { field: "name", label: "Name" },
      { field: "site", label: "Site", type: "url", optional: true },
    ];
    expect(typedOf(form, { name: "Acme", site: "" })).toEqual({ name: "Acme" });
  });
});

describe("HandlerForm", () => {
  const run = () => Promise.resolve(null);
  it("asks the key first, then a box per field, and names the effect", () => {
    const html = renderToStaticMarkup(
      createElement(HandlerForm, {
        id: "Mail/send",
        name: "send",
        fields: [
          { field: "policy", label: "Policy", type: "select", options: ["skip", "recheck"] },
        ],
        keyed: true,
        effect: "sends",
        run,
      }),
    );
    expect(html.indexOf("Key")).toBeLessThan(html.indexOf("Policy"));
    expect(html).toContain('<option value="recheck">recheck</option>');
    expect(html).toContain("It sends to a person.");
  });

  it("asks the whole input as JSON when there's no form, nothing when it takes none", () => {
    const of = (fields: FormField[] | null) =>
      renderToStaticMarkup(
        createElement(HandlerForm, { id: "x", name: "x", fields, keyed: false, effect: null, run }),
      );
    expect(of(null)).toContain("Input");
    expect(of([])).toContain("It takes no input.");
  });
});
