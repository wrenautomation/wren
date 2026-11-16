import { describe, expect, it } from "vitest";
import { usesOf } from "./profile-records.js";
import { emailKey, keyOf, keysOf, nameOfFields, phoneKey } from "./profiles.js";
import { handleOfUrl, profileFrom } from "./profiles-backfill.js";
import type { Workflow } from "./workflows.js";

describe("profile keys", () => {
  it("reads emails and phones one way", () => {
    expect(emailKey(" Mailto:Ann@Example.TEST ")).toBe("ann@example.test");
    expect(emailKey("ann at example")).toBeNull();
    expect(phoneKey("(555) 010-0101")).toBe("+15550100101");
    expect(phoneKey("(212) 555-0101")).toBe("+12125550101");
    expect(phoneKey("1 212 555 0101")).toBe("+12125550101");
    expect(phoneKey("+44 20 7946 0958")).toBe("+442079460958");
    expect(phoneKey("12")).toBeNull();
  });

  it("keeps only keys that are keys, each once", () => {
    expect(
      keysOf([
        { kind: "email", value: "A@example.test" },
        { kind: "email", value: "a@example.test" },
        { kind: "person", value: 42 },
        { kind: "person", value: 0 },
        { kind: "visitor", value: "v_abc123" },
        { kind: "visitor", value: "x" },
        { kind: "crm:bullhorn", value: "77" },
        { kind: "crm:Bad Slug", value: "77" },
        { kind: "nope", value: "x" },
      ]),
    ).toEqual([
      { kind: "email", value: "a@example.test" },
      { kind: "person", value: "42" },
      { kind: "visitor", value: "v_abc123" },
      { kind: "crm:bullhorn", value: "77" },
    ]);
    expect(keyOf({ kind: "email", value: null })).toBeNull();
  });

  it("reads a social URL as its handle", () => {
    expect(handleOfUrl("https://www.linkedin.com/in/ann-lee-123/")?.kind).toBe("handle:linkedin");
    expect(handleOfUrl("https://example.test/about")).toBeNull();
    expect(handleOfUrl(null)).toBeNull();
  });

  it("splits a form into keys, a name and traits, never its message", () => {
    const f = profileFrom.form({
      fields: {
        email: "b@example.test",
        first_name: "Bo",
        last_name: "Diaz",
        message: "call me",
        budget: "5k",
        "Bad Key": "x",
      },
      visitor: "v_abc123",
    });
    expect(f.name).toBe("Bo Diaz");
    expect(f.traits).toEqual({ budget: "5k" });
    expect(keysOf(f.keys).map((k) => k.kind)).toEqual(["email", "visitor"]);
    expect(nameOfFields({ name: " Cy " })).toBe("Cy");
  });
});

describe("usesOf", () => {
  it("names the workflows that hear a timeline kind or read a trait", () => {
    const flows = [
      {
        id: "a",
        name: "Follow up",
        nodes: [
          { id: "t", uses: "trigger.reply" },
          { id: "b", uses: "branch", with: { when: "trait.plan = 'pro'" } },
        ],
      },
      { id: "b", name: "Book", nodes: [{ id: "t", uses: "trigger.booking" }] },
    ] as unknown as Workflow[];
    const uses = usesOf(flows);
    expect(uses.get("event:email_received")).toEqual(["Follow up"]);
    expect(uses.get("event:text_received")).toEqual(["Follow up"]);
    expect(uses.get("trait:plan")).toEqual(["Follow up"]);
    expect(uses.get("event:booking")).toEqual(["Book"]);
  });
});
