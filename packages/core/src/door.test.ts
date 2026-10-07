import { describe, expect, it } from "vitest";
import { fieldMapOf, fieldMapOfWith, fieldMapProblems, HOOK_PRESETS, leadOf } from "./door.js";

describe("leadOf", () => {
  it("reads the common names when the map is empty", () => {
    expect(
      leadOf({
        first_name: "Dana",
        last_name: "Reyes",
        phone_number: "(201) 555-0142",
        email: " Dana@Example.test ",
        sms_consent: "on",
        utm_source: "site",
      }),
    ).toEqual({
      name: "Dana Reyes",
      phone: "(201) 555-0142",
      email: "dana@example.test",
      consent: true,
      consentDetail: 'sms_consent="on"',
      source: "site",
      zone: null,
      niche: null,
    });
  });

  it("takes the map's paths over the common names", () => {
    const lead = leadOf(
      { contact: { tel: "+12015550142", agree: true }, phone: "wrong", tz: "America/Chicago" },
      { phone: "contact.tel", consent: "contact.agree" },
    );
    expect(lead).toMatchObject({ phone: "+12015550142", consent: true, zone: "America/Chicago" });
  });

  it("never reads a missing or odd consent as yes", () => {
    for (const v of [undefined, false, 0, "", "no", "maybe", null])
      expect(leadOf({ phone: "2015550142", consent: v }).consent).toBe(false);
    expect(leadOf("not an object")).toMatchObject({ phone: null, consent: false });
  });

  it("drops an email that isn't one", () => {
    expect(leadOf({ email: "nope" }).email).toBeNull();
  });
});

describe("the site preset", () => {
  // What the lander posts for a stored application (lander/functions/_shared/door.ts).
  const SITE = {
    id: "site:applications:7",
    source: "site",
    form: "apply",
    name: "Bo Test",
    email: "bo@example.test",
    phone: "(312) 555-0144",
    sms_consent: true,
    niche: "Recruiting",
    utm_source: "email",
    first_touch: { source: "email", page: "/recruiting/lead-reactivation" },
  };

  it("reads a lander row as the lead, source site and its niche", () => {
    expect(leadOf(SITE, HOOK_PRESETS.site?.fields)).toEqual({
      name: "Bo Test",
      phone: "(312) 555-0144",
      email: "bo@example.test",
      consent: true,
      consentDetail: "sms_consent=true",
      source: "site",
      zone: null,
      niche: "recruiting",
    });
  });

  it("a form with no consent box is no consent", () => {
    const { sms_consent: _, ...lead } = SITE;
    expect(leadOf(lead, HOOK_PRESETS.site?.fields)).toMatchObject({
      consent: false,
      consentDetail: null,
    });
  });
});

describe("fieldMapOf", () => {
  it("reads pairs and refuses an unknown fact", () => {
    expect(fieldMapOf(["phone=contact.tel", "name=who"])).toEqual({
      phone: "contact.tel",
      name: "who",
    });
    expect(() => fieldMapOf(["fax=x"])).toThrow("phone=contact.phone");
    expect(() => fieldMapOf(["phone="])).toThrow();
  });
});

describe("a door node's field map", () => {
  it("reads map.<fact> settings and leaves blanks out", () => {
    expect(
      fieldMapOfWith({
        subject: "email",
        "map.phone": "contact.tel",
        "map.email": " ",
        kind: "lead",
      }),
    ).toEqual({ phone: "contact.tel" });
  });

  it("says which paths won't read", () => {
    expect(fieldMapProblems({ phone: "contact.tel", email: "a b" })).toEqual([
      "email reads like contact.email",
    ]);
  });
});
