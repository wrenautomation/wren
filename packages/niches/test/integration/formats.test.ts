/**
 * The niche formats through the real importers: a firm feed keys companies by CRD
 * and attaches only real domains; a Clutch directory never keys a company by its
 * listing host; a filing-data zip lands people under their firm.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companies, people, runImport, runPeopleImport } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc } from "drizzle-orm";
import { zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LEAD_SOURCE_FORMATS,
  NICHE_PLATFORM_DOMAINS,
  PERSON_SOURCE_FORMATS,
} from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "leads", "people"]));
const db = () => pg.db;
const tmp = () => mkdtempSync(join(tmpdir(), "formats-"));
const format = (name: string) =>
  LEAD_SOURCE_FORMATS.get(name) as NonNullable<ReturnType<typeof LEAD_SOURCE_FORMATS.get>>;
const allCompanies = () => db().select().from(companies).orderBy(asc(companies.id));

describe("niche formats through runImport", () => {
  it("sec-firm-feed keys by CRD and attaches the first real domain", async () => {
    const path = join(tmp(), "feed.xml");
    writeFileSync(
      path,
      `<?xml version="1.0" encoding="ISO-8859-1"?><IAPDFirmSECReport><Firms>
<Firm><Info FirmCrdNb="283882" BusNm="RABENOLD ADVISORS, INC."/><MainAddr City="WILLIAMSVILLE" State="NY" Cntry="United States"/>
<FormInfo><Part1A><Item1><WebAddrs><WebAddr>HTTPS://WWW.LINKEDIN.COM/COMPANY/RABENOLD</WebAddr><WebAddr>HTTP://WWW.RABENOLDADVISORS.COM</WebAddr></WebAddrs></Item1><Item5A TtlEmp="4"/></Part1A></FormInfo></Firm>
<Firm><Info FirmCrdNb="312360" BusNm="MK CAPITAL"/><MainAddr City="NORTHFIELD" State="IL" Cntry="United States"/></Firm>
</Firms></IAPDFirmSECReport>`,
      "latin1",
    );
    const f = format("sec-firm-feed");
    const { stats } = await runImport(db(), f.build(path), {
      niche: f.niche,
      extraPlatformDomains: NICHE_PLATFORM_DOMAINS,
    });
    expect(stats).toMatchObject({ rows: 2, companies_created: 2, errors: 0 });
    const rows = await allCompanies();
    expect(rows.map((c) => [c.sourceKey, c.domain, c.niche])).toEqual([
      ["crd:283882", "rabenoldadvisors.com", "sec_ria"],
      ["crd:312360", null, "sec_ria"],
    ]);
    expect(rows[0]?.raw).toMatchObject({ "5A": "4" });
  });

  it("clutch-pages never keys a company by the listing host", async () => {
    const dir = join(tmp(), "design");
    mkdirSync(dir, { recursive: true });
    const card = (name: string, slug: string, u: string, sponsor: string) => `
<div class="provider-row"><h3><a href="https://clutch.co/profile/${slug}" class="provider__title-link">${name}</a></h3>
<span>4.8</span><span>$25,000+</span><span>10 - 49</span><span>Austin, TX</span><span>60% Pay Per Click</span>
<a href="https://clutch.co/profile/${slug}">View Profile</a>
<a href="https://r.clutch.co/redirect?is_sponsor=${sponsor}&amp;u=${u}">Visit Website</a></div>`;
    writeFileSync(
      join(dir, "Page 1.html"),
      card("Huemor", "huemor", "https%3A%2F%2Fhuemor.rocks%2F", "false") +
        card("AdShop", "adshop", "https%3A%2F%2Fppc.clutch.co%2Fclick", "true"),
    );
    const f = format("clutch-pages");
    expect(f.directory).toBe(true);
    const { stats } = await runImport(db(), f.build(dir), {
      niche: f.niche,
      extraPlatformDomains: NICHE_PLATFORM_DOMAINS,
    });
    expect(stats).toMatchObject({ rows: 2, companies_created: 2, errors: 0 });
    const rows = await allCompanies();
    expect(rows.map((c) => [c.sourceKey, c.domain, c.name, c.niche])).toEqual([
      [null, "huemor.rocks", "Huemor", "agencies"],
      ["clutch:adshop", null, "AdShop", "agencies"],
    ]);
    // The profile URL is kept, as a social URL, never as a domain.
    expect(rows[1]?.socialUrl).toBe("https://clutch.co/profile/adshop");
    expect(rows[0]?.raw).toMatchObject({ "agency.services": "60% Pay Per Click" });
  });

  it("adv-filing-data lands people under their firm, creating it if unknown", async () => {
    const csv = (header: string[], rows: string[][]) =>
      Buffer.from(
        `${[header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")}\n`,
        "latin1",
      );
    const path = join(tmp(), "ADV_Filing_Data_20260701_20260731.zip");
    writeFileSync(
      path,
      zipSync({
        "IA_ADV_Base_A_x.csv": csv(
          ["FilingID", "DateSubmitted", "1A", "1B1", "1E1"],
          [["100", "07/10/2026 04:20:33 PM", "ACME ADVISORS LLC", "ACME ADVISORS", "5001"]],
        ),
        "IA_Schedule_A_B_x.csv": csv(
          ["FilingID", "Full Legal Name", "DE/FE/I", "Title or Status"],
          [["100", "NESS, BRIAN", "I", "CHIEF OPERATING OFFICER"]],
        ),
        "IA_ADV_1J_1K_x.csv": csv(
          ["FilingID", "1J1 Name", "1K Name"],
          [["100", "KORI CUSICK", ""]],
        ),
      }),
    );
    const f = PERSON_SOURCE_FORMATS.get("adv-filing-data") as NonNullable<
      ReturnType<typeof PERSON_SOURCE_FORMATS.get>
    >;
    const { stats } = await runPeopleImport(db(), f.build(path), { niche: f.niche });
    expect(stats).toMatchObject({
      rows: 2,
      people_created: 2,
      companies_created: 1,
      compliance_flagged: 1,
    });
    const [firm] = await allCompanies();
    expect(firm).toMatchObject({ sourceKey: "crd:5001", niche: "sec_ria" });
    const staff = await db().select().from(people).orderBy(asc(people.id));
    expect(staff.map((p) => [p.fullName, p.isCompliance])).toEqual([
      ["Brian Ness", false],
      ["Kori Cusick", true],
    ]);
  });
});
