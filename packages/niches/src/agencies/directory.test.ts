/** The directory adapter's identity policy: domain-first, slug key only for a listing URL, nothing folded or dropped. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintedIdentity, type RawRow } from "@wren/core";
import { describe, expect, it } from "vitest";
import { AgencyDirectoryCsvSource } from "./directory.js";

const quote = (cell: string) => `"${cell.replaceAll('"', '""')}"`;

function rowsFrom(header: string[], rows: string[][]): RawRow[] {
  const path = join(mkdtempSync(join(tmpdir(), "directory-")), "export.csv");
  writeFileSync(path, [header, ...rows].map((r) => r.map(quote).join(",")).join("\n"));
  return [...new AgencyDirectoryCsvSource(path).rows()];
}
const one = (header: string[], row: string[]) => rowsFrom(header, [row])[0] as RawRow;

describe("AgencyDirectoryCsvSource", () => {
  it("mints no key when the row has a real domain", () => {
    const row = one(
      ["Name", "Website", "Profile URL"],
      ["Instrument", "https://instrument.com", "https://clutch.co/profile/instrument"],
    );
    expect(mintedIdentity(row)).toBeNull();
    expect(row.Website).toBe("https://instrument.com");
  });

  it("makes a real site in the profile column the website", () => {
    const row = one(
      ["Name", "Website", "Profile URL"],
      ["Instrument", "", "https://instrument.com"],
    );
    expect(mintedIdentity(row)).toBeNull();
    expect(row.website).toBe("https://instrument.com");
  });

  it("gives a domainless row a slug key and keeps the profile", () => {
    const row = one(
      ["Name", "Website", "Profile URL"],
      ["Instrument", "", "https://clutch.co/profile/instrument"],
    );
    expect(mintedIdentity(row)).toBe("clutch:instrument");
    expect(row.website).toBe("https://clutch.co/profile/instrument"); // classifyRow keeps it as social_url
    expect(row.company_name).toBe("Instrument"); // a bare Name on a person-less row is the agency's
  });

  it("keys on a directory URL in the website column too", () => {
    const row = one(
      ["Name", "Website"],
      ["Studio Rodrigo", "https://clutch.co/profile/studio-rodrigo"],
    );
    expect(mintedIdentity(row)).toBe("clutch:studio-rodrigo");
    expect(row.Website).toBe("https://clutch.co/profile/studio-rodrigo"); // original untouched
  });

  it("re-homes a junk placeholder instead of letting it erase the prepend", () => {
    const row = one(
      ["company_name", "website", "profile_url"],
      ["Instrument", "N/A", "https://instrument.com"],
    );
    expect(row.website).toBe("https://instrument.com");
    expect(row["website (raw)"]).toBe("N/A");
  });

  it("mints nothing from a category or bare-host URL", () => {
    const rows = rowsFrom(
      ["Name", "Profile URL"],
      [
        ["Instrument", "https://clutch.co/agencies/digital-marketing"],
        ["Mystery Agency", "https://clutch.co"],
      ],
    );
    expect(rows.map(mintedIdentity)).toEqual([null, null]);
  });

  it("withholds the second key when one slug carries two names", () => {
    const rows = rowsFrom(
      ["Name", "Profile URL"],
      [
        ["Instrument", "https://clutch.co/profile/digital"],
        ["Huge", "https://clutch.co/profile/digital"],
      ],
    );
    expect(rows.map(mintedIdentity)).toEqual(["clutch:digital", null]);
  });

  it("refuses an overlong slug key rather than sinking the row", () => {
    const slug = "full-service-digital-marketing-and-branding-agency-new-york";
    const row = one(
      ["Name", "Email", "Profile URL"],
      ["Long Co", "jane@gmail.com", `https://designrush.com/agency/profile/${slug}`],
    );
    expect(mintedIdentity(row)).toBeNull();
  });

  it("counts a spare duplicate profile column", () => {
    const row = one(
      ["Name", "profile_url", "profile_url"],
      ["Instrument", "", "https://clutch.co/profile/instrument"],
    );
    expect(mintedIdentity(row)).toBe("clutch:instrument");
  });

  it("normalizes fact columns to agency.* keys and leaves absent ones absent", () => {
    const row = one(
      [
        "Name",
        "Website",
        "Min. Project Size",
        "Avg. Hourly Rate",
        "Company Size",
        "Services",
        "Founded",
      ],
      [
        "Instrument",
        "https://instrument.com",
        "$5,000+",
        "$100 - $149 / hr",
        "10 - 49",
        "Social Media Marketing, PPC",
        "",
      ],
    );
    expect(row).toMatchObject({
      "agency.min_budget": "$5,000+",
      "agency.hourly_rate": "$100 - $149 / hr",
      "agency.team_size": "10 - 49",
      "agency.services": "Social Media Marketing, PPC",
      "Min. Project Size": "$5,000+",
    });
    expect(row).not.toHaveProperty("agency.founded");
  });

  it("never lets a raw source_key column become identity", () => {
    const row = one(
      ["Name", "Website", "source_key"],
      ["Instrument", "https://instrument.com", "crd:999"],
    );
    expect(mintedIdentity(row)).toBeNull();
    expect(row.source_key).toBe("crd:999");
  });
});
