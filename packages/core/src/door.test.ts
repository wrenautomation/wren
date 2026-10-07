import { describe, expect, it } from "vitest";
import { fieldMapOf, leadOf } from "./door.js";

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
