import { describe, expect, it } from "vitest";
import { contactLinks, contactSchema } from "./contact.js";
import { calendarSettingsSchema } from "./rules.js";

describe("a client's contact links", () => {
  it("are none by default", () => {
    expect(contactLinks(undefined)).toEqual([]);
    expect(contactLinks({})).toEqual([]);
    expect(calendarSettingsSchema.parse({}).contact).toEqual({
      email: "",
      phone: "",
      instagram: "",
      x: "",
      linkedin: "",
    });
  });

  it("link each one that is set, in order", () => {
    expect(
      contactLinks({
        linkedin: "https://www.linkedin.com/company/acme-dental",
        x: "acme",
        instagram: "@acme.dental",
        phone: "+1 (416) 555-0100",
        email: " desk@acme.example ",
      }),
    ).toEqual([
      { kind: "email", label: "desk@acme.example", href: "mailto:desk@acme.example" },
      { kind: "phone", label: "+1 (416) 555-0100", href: "tel:+14165550100" },
      {
        kind: "instagram",
        label: "@acme.dental",
        href: "https://www.instagram.com/acme.dental",
      },
      { kind: "x", label: "@acme", href: "https://x.com/acme" },
      {
        kind: "linkedin",
        label: "LinkedIn",
        href: "https://www.linkedin.com/company/acme-dental",
      },
    ]);
  });

  it("refuse what doesn't read, at save", () => {
    for (const bad of [
      { email: "desk" },
      { x: "a b" },
      { linkedin: "javascript:alert(1)" },
      { linkedin: "https://evil.example/in/x" },
      { phone: "call me" },
    ])
      expect(contactSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(contactLinks({ email: "desk" })).toEqual([]);
  });
});
