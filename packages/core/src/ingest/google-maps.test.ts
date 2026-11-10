import { describe, expect, it } from "vitest";
import { mapsRow } from "./google-maps.js";
import { classifyRow } from "./schema.js";

const listing = {
  title: "Acme Heating & Air",
  category: "HVAC contractor",
  website: "https://www.acmehvac.com/?utm_source=gmb",
  phone: "+1 555-0100",
  emails: "info@acmehvac.com, sales@acmehvac.com",
  complete_address: '{"city":"Austin","state":"TX","country":"US"}',
  owner: '{"id":"1","name":"Acme Heating & Air"}',
  cid: "1234567890",
};

describe("google-maps rows", () => {
  it("a listing with a site and an inbox is a lead on the business, not a person", () => {
    const row = classifyRow(mapsRow(listing));
    expect(row).toMatchObject({
      kind: "lead",
      email: "info@acmehvac.com",
      firstName: null,
      title: null,
      companyName: "Acme Heating & Air",
      companyDomain: "acmehvac.com",
      geo: "Austin, TX",
      country: "US",
      source: "google_maps",
      sourceKey: null,
    });
    expect(mapsRow(listing)).toMatchObject({ "title (raw)": listing.title, phone: listing.phone });
  });

  it("no website, or a Facebook page: keyed by the place id", () => {
    for (const website of ["", "https://facebook.com/acmehvac"]) {
      const row = classifyRow(mapsRow({ ...listing, website, emails: "" }));
      expect(row).toMatchObject({ kind: "company", domain: null, sourceKey: "gmaps:1234567890" });
    }
  });

  it("picks the inbox on the site's domain over a web agency's", () => {
    const emails = "team@rsmconnect.com, wpm@webmastered.com, info@acmehvac.com";
    expect(mapsRow({ ...listing, emails }).email).toBe("info@acmehvac.com");
    expect(mapsRow({ ...listing, emails: "wpm@webmastered.com, acmehvac@gmail.com" }).email).toBe(
      "acmehvac@gmail.com",
    );
    const agency = mapsRow({ ...listing, emails: "wpm@webmastered.com" });
    expect(agency.email).toBeUndefined();
    expect(agency.emails).toBe("wpm@webmastered.com");
  });

  it("no website: the first email", () => {
    const row = mapsRow({ ...listing, website: "", emails: "a@vendor.com, b@gmail.com" });
    expect(row.email).toBe("a@vendor.com");
  });

  it("the kit's social columns ride along", () => {
    const row = mapsRow({ ...listing, instagram: "https://instagram.com/acme", facebook: "fb" });
    expect(row).toMatchObject({ instagram: "https://instagram.com/acme", facebook: "fb" });
  });

  it("a broken address cell is kept, not fatal", () => {
    const row = mapsRow({ ...listing, complete_address: "{oops" });
    expect(row.geo).toBeUndefined();
    expect(row.complete_address).toBe("{oops");
  });
});
