import { describe, expect, it } from "vitest";
import { officerPersonRow } from "./officers.js";

describe("registry officer rows", () => {
  it("cases a shouted name and keys the firm by source key", () => {
    const row = {
      company_source_key: "sba:000001",
      full_name: "JANE Q DOE",
      title: "CEO",
      registry_ref: "ny-dos:1",
      as_of: "2026-10-01",
    };
    expect(officerPersonRow(row, "f.csv")).toMatchObject({
      kind: "person",
      fullName: "Jane Q Doe",
      firstName: "Jane",
      lastName: "Doe",
      title: "CEO",
      companySourceKey: "sba:000001",
      companyDomain: null,
      origin: "registry",
      originRef: "ny-dos:1",
    });
  });

  it("a row with no firm or no name is an error, kept", () => {
    expect(officerPersonRow({ full_name: "Jane Doe" }, "f.csv").kind).toBe("error");
    expect(officerPersonRow({ company_domain: "doe.example" }, "f.csv").kind).toBe("error");
  });
});
