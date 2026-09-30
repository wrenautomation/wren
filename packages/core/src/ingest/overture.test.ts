import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAIN_AT,
  declineReason,
  type OverturePlace,
  OverturePlacesSource,
  overtureFormat,
  overtureRow,
  placeDomain,
} from "./overture.js";
import { classifyRow, IDENTITY_KEY } from "./schema.js";

const place = (over: OverturePlace = {}): OverturePlace => ({
  id: "08f2a100000000000000000000000001",
  names: { primary: "Acme Staffing" },
  websites: ["https://www.acmestaffing.example/jobs?utm_source=maps"],
  emails: ["jobs@acmestaffing.example"],
  phones: ["+15125550100"],
  addresses: [{ locality: "Austin", region: "TX", country: "US", postcode: "78701" }],
  operating_status: "open",
  taxonomy: { primary: "employment_agency" },
  ...over,
});

const dir = mkdtempSync(join(tmpdir(), "wren-overture-"));
let n = 0;
const writeJsonl = (lines: string[]) => {
  const path = join(dir, `places-${n++}.jsonl`);
  writeFileSync(path, lines.join("\n"));
  return path;
};
const jsonl = (places: OverturePlace[]) => writeJsonl(places.map((p) => JSON.stringify(p)));

describe("placeDomain", () => {
  it("the first site's domain, www and path dropped", () => {
    expect(placeDomain(place())).toBe("acmestaffing.example");
  });

  it("null with no site, a blank site, a platform page, or not a domain", () => {
    for (const websites of [
      undefined,
      [],
      ["  "],
      ["https://facebook.com/acme"],
      ["not a site"],
      "acme.example",
    ])
      expect(placeDomain(place({ websites }))).toBeNull();
  });

  it("blank entries are skipped before picking the first", () => {
    expect(placeDomain(place({ websites: ["", 7, "acme.example"] }))).toBe("acme.example");
  });
});

describe("overtureRow", () => {
  it("lifts canonical fields and keeps the place whole", () => {
    const p = place();
    const row = overtureRow(p, 1);
    expect(row).toEqual({
      company_name: "Acme Staffing",
      website: "https://www.acmestaffing.example/jobs?utm_source=maps",
      email: "jobs@acmestaffing.example",
      phone: "+15125550100",
      geo: "Austin, TX",
      country: "US",
      postcode: "78701",
      source: "overture",
      places_with_domain: 1,
      overture: p,
    });
    expect(row[IDENTITY_KEY]).toBeUndefined(); // a domain keys it
    expect(classifyRow(row)).toMatchObject({
      kind: "lead",
      email: "jobs@acmestaffing.example",
      companyDomain: "acmestaffing.example",
      companyName: "Acme Staffing",
      geo: "Austin, TX",
      country: "US",
      source: "overture",
      sourceKey: null,
    });
  });

  it("no usable site: keyed overture:<id>; a platform page rides along as the social url", () => {
    const row = overtureRow(place({ websites: ["https://facebook.com/acme"], emails: [] }), 0);
    expect(row[IDENTITY_KEY]).toEqual({ source_key: "overture:08f2a100000000000000000000000001" });
    expect(classifyRow(row)).toMatchObject({
      kind: "company",
      domain: null,
      sourceKey: "overture:08f2a100000000000000000000000001",
      socialUrl: "https://facebook.com/acme",
      name: "Acme Staffing",
    });
  });

  it("no site and no id: nothing minted", () => {
    const row = overtureRow(place({ websites: [], id: "  " }), 0);
    expect(row[IDENTITY_KEY]).toBeUndefined();
  });

  it("only an address-like email is lifted; missing parts are left out", () => {
    const row = overtureRow(
      place({
        names: { common: "x" },
        emails: ["call us", "info@acme.example"],
        phones: [],
        addresses: [{ region: "ON", country: "CA" }],
      }),
      2,
    );
    expect(row.email).toBe("info@acme.example");
    expect(row.company_name).toBeUndefined();
    expect(row.phone).toBeUndefined();
    expect(row.geo).toBe("ON");
    expect(row.postcode).toBeUndefined();
    expect(row.country).toBe("CA");
    expect(row.places_with_domain).toBe(2);
  });

  it("no addresses: no geo, no country", () => {
    const row = overtureRow(place({ addresses: null }), 0);
    expect(row.geo).toBeUndefined();
    expect(row.country).toBeUndefined();
  });
});

describe("declineReason", () => {
  const opts = { chainAt: 3 };
  const check = (p: OverturePlace, n = 1, o: Parameters<typeof declineReason>[3] = opts) =>
    declineReason(p, placeDomain(p), n, o);

  it("an open independent firm is kept", () => {
    expect(check(place())).toBeNull();
  });

  it("closed first, even over public body and chain", () => {
    expect(
      check(
        place({ operating_status: "permanently_closed", websites: ["https://twc.texas.gov"] }),
        9,
      ),
    ).toBe("closed");
    expect(check(place({ operating_status: "temporarily_closed" }))).toBeNull();
  });

  it.each([
    "https://www.texas.gov/jobs",
    "workforce.ca.gov",
    "https://recruiting.army.mil",
    "https://www.jobbank.gc.ca",
    "https://www.canada.ca/en/employment",
    "https://www2.gov.bc.ca/careers",
  ])("public body: %s", (site) => {
    expect(check(place({ websites: [site] }))).toBe("public_body");
  });

  it.each(["https://staffingcanada.ca", "https://govstaffing.example", "https://notgov.com"])(
    "not a public body: %s",
    (site) => {
      expect(check(place({ websites: [site] }))).toBeNull();
    },
  );

  it("public body: a Quebec government host (gouv.qc.ca)", () => {
    expect(check(place({ websites: ["https://www.emploi.gouv.qc.ca"] }))).toBe("public_body");
  });

  it("the niche's rule comes before chain and sees the keying domain", () => {
    const seen: (string | null)[] = [];
    const decline = (_p: OverturePlace, d: string | null) => {
      seen.push(d);
      return d?.endsWith(".org") ? "nonprofit" : null;
    };
    expect(check(place({ websites: ["https://www.jobs.org"] }), 5, { chainAt: 3, decline })).toBe(
      "nonprofit",
    );
    expect(check(place(), 5, { chainAt: 3, decline })).toBe("chain");
    expect(seen).toEqual(["jobs.org", "acmestaffing.example"]);
  });

  it("chain at chainAt places with the domain; no domain is never a chain", () => {
    expect(check(place(), 2)).toBeNull();
    expect(check(place(), 3)).toBe("chain");
    expect(check(place({ websites: [] }), 50)).toBeNull();
  });
});

describe("OverturePlacesSource", () => {
  it("declines chains, closed and public places by reason and yields the rest", () => {
    const chain = (i: number, over: OverturePlace = {}) =>
      place({ id: `chain-${i}`, websites: [`https://bigstaff.example/branch/${i}`], ...over });
    const path = jsonl([
      place(),
      chain(1),
      chain(2),
      chain(3),
      // Two open + one closed: the closed one doesn't make it a chain.
      place({ id: "pair-1", websites: ["pair.example"] }),
      place({ id: "pair-2", websites: ["pair.example"] }),
      place({ id: "pair-3", websites: ["pair.example"], operating_status: "permanently_closed" }),
      place({ id: "gov-1", websites: ["https://twc.texas.gov"] }),
      place({ id: "nosite", websites: [], emails: [] }),
    ]);
    const source = new OverturePlacesSource(path);
    const rows = [...source.rows()];
    expect(rows.map((r) => (r.overture as OverturePlace).id)).toEqual([
      "08f2a100000000000000000000000001",
      "pair-1",
      "pair-2",
      "nosite",
    ]);
    expect(rows.map((r) => r.places_with_domain)).toEqual([1, 2, 2, 0]);
    expect(rows[3]?.[IDENTITY_KEY]).toEqual({ source_key: "overture:nosite" });
    expect(source.declined()).toEqual({ chain: 3, closed: 1, public_body: 1 });
    expect(source.sourceType).toBe("overture");
    expect(source.sourceRef).toBe(path);
  });

  it("chainAt and the niche's decline are honoured", () => {
    const path = jsonl([
      place({ id: "a", websites: ["duo.example"] }),
      place({ id: "b", websites: ["duo.example"] }),
      place({ id: "c", websites: ["solo.example"], names: { primary: "Skip Me" } }),
      place({ id: "d", websites: ["keep.example"] }),
    ]);
    const source = new OverturePlacesSource(path, {
      chainAt: 2,
      decline: (p) => ((p.names as { primary: string }).primary === "Skip Me" ? "mine" : null),
    });
    expect([...source.rows()].map((r) => (r.overture as OverturePlace).id)).toEqual(["d"]);
    expect(source.declined()).toEqual({ chain: 2, mine: 1 });
  });

  it("default chain threshold is CHAIN_AT", () => {
    const places = Array.from({ length: CHAIN_AT }, (_, i) =>
      place({ id: `x${i}`, websites: ["many.example"] }),
    );
    const source = new OverturePlacesSource(jsonl(places));
    expect([...source.rows()]).toHaveLength(0);
    expect(source.declined()).toEqual({ chain: CHAIN_AT });
  });

  it("blank lines and non-object lines are skipped; the hash is of the bytes", () => {
    const lines = ["", JSON.stringify(place()), "   ", "[1,2]", "null", '"text"', "42", ""];
    const path = writeJsonl(lines);
    const source = new OverturePlacesSource(path);
    expect([...source.rows()]).toHaveLength(1);
    expect(source.contentHash).toBe(createHash("sha256").update(lines.join("\n")).digest("hex"));
    expect(source.declined()).toEqual({});
  });

  it("a broken line fails the read", () => {
    const source = new OverturePlacesSource(writeJsonl([JSON.stringify(place()), '{"id": "cut']));
    expect(() => [...source.rows()]).toThrow();
  });

  it("declined() is a copy", () => {
    const source = new OverturePlacesSource(
      jsonl([place({ operating_status: "permanently_closed" })]),
    );
    [...source.rows()];
    const d = source.declined();
    d.closed = 99;
    expect(source.declined()).toEqual({ closed: 1 });
  });
});

describe("overtureFormat", () => {
  it("a file format stamped with the niche that builds the source with its options", () => {
    const format = overtureFormat({
      name: "overture-demo",
      help: "demo help",
      niche: "demo",
      chainAt: 2,
      decline: (p) => (p.id === "b" ? "mine" : null),
    });
    expect(format).toMatchObject({
      name: "overture-demo",
      help: "demo help",
      niche: "demo",
      columnMapped: false,
      directory: false,
    });
    const path = jsonl([
      place({ id: "a", websites: ["duo.example"] }),
      place({ id: "c", websites: ["duo.example"] }),
      place({ id: "b", websites: ["solo.example"] }),
      place({ id: "d", websites: ["keep.example"] }),
    ]);
    const source = format.build(path) as OverturePlacesSource;
    expect(source).toBeInstanceOf(OverturePlacesSource);
    expect([...source.rows()].map((r) => (r.overture as OverturePlace).id)).toEqual(["d"]);
    expect(source.declined()).toEqual({ chain: 2, mine: 1 });
  });
});
