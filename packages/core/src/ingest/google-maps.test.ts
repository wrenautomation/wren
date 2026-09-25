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

  it("a broken address cell is kept, not fatal", () => {
    const row = mapsRow({ ...listing, complete_address: "{oops" });
    expect(row.geo).toBeUndefined();
    expect(row.complete_address).toBe("{oops");
  });
});
