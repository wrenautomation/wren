/** Firm-feed adapter against XML shaped like the real IA_FIRM_SEC_Feed. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { classifyRow, IDENTITY_KEY, type RawRow } from "@wren/core";
import { describe, expect, it } from "vitest";
import { SecFirmFeedSource } from "./firm-feed.js";

const FEED_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<IAPDFirmSECReport GenOn="2026-09-02">
  <Firms>
    <Firm>
      <Info SECRgnCD="NYRO" FirmCrdNb="283882" BusNm="RABENOLD ADVISORS, INC."
            LegalNm="RABENOLD ADVISORS, INC."/>
      <MainAddr Strt1="5930 MAIN STREET" City="WILLIAMSVILLE" State="NY"
                Cntry="United States" PostlCd="14221"/>
      <Rgstn FirmType="Registered" St="APPROVED" Dt="2026-02-24"/>
      <NoticeFiled>
        <States RgltrCd="NY" St="FILED" Dt="2026-02-24"/>
        <States RgltrCd="PA" St="FILED" Dt="2026-03-01"/>
      </NoticeFiled>
      <FormInfo>
        <Part1A>
          <Item1>
            <WebAddrs>
              <WebAddr>HTTPS://WWW.LINKEDIN.COM/COMPANY/RABENOLD</WebAddr>
              <WebAddr>HTTP://WWW.RABENOLDADVISORS.COM</WebAddr>
            </WebAddrs>
          </Item1>
          <Item5A TtlEmp="4"/>
          <Item5D Q5DA1="73" Q5DA3="15567197" Q5DB1="9"/>
          <Item5F Q5F1="Y" Q5F2A="35557038" Q5F2C="35557038"/>
        </Part1A>
      </FormInfo>
    </Firm>
    <Firm>
      <Info FirmCrdNb="312360" BusNm="MK CAPITAL"/>
      <MainAddr City="NORTHFIELD" State="IL" Cntry="United States"/>
      <FormInfo><Part1A><Item5F Q5F2C="900000"/></Part1A></FormInfo>
    </Firm>
    <Firm>
      <Info SECRgnCD="X" BusNm="NO CRD LLC"/>
    </Firm>
  </Firms>
</IAPDFirmSECReport>
`;

function writeFeed(gzipped: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "feed-"));
  const bytes = Buffer.from(FEED_XML, "latin1");
  const path = join(dir, gzipped ? "feed.xml.gz" : "feed.xml");
  writeFileSync(path, gzipped ? gzipSync(bytes) : bytes);
  return path;
}
async function rowsOf(path: string): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  for await (const row of new SecFirmFeedSource(path).rows()) rows.push(row);
  return rows;
}

describe("SecFirmFeedSource", () => {
  it("translates the dialect", async () => {
    const rows = await rowsOf(writeFeed(false));
    expect(rows).toHaveLength(2); // the CRD-less firm is unfindable and skipped
    const [rabenold, mk] = rows as [RawRow, RawRow];
    expect(rabenold).toMatchObject({
      [IDENTITY_KEY]: { source_key: "crd:283882" },
      company_name: "RABENOLD ADVISORS, INC.",
      website: "HTTP://WWW.RABENOLDADVISORS.COM", // first non-platform address
      WebAddrs: ["HTTPS://WWW.LINKEDIN.COM/COMPANY/RABENOLD", "HTTP://WWW.RABENOLDADVISORS.COM"],
      geo: "Williamsville, NY",
      country: "US",
      "5F(2)(c)": "35557038",
      "5A": "4",
      "5D(a)(1)": "73",
      "5D(b)(1)": "9",
      "Info.FirmCrdNb": "283882",
      "NoticeFiled.States.RgltrCd": "NY",
      "NoticeFiled.States.RgltrCd__2": "PA",
    });
    expect(rabenold).not.toHaveProperty("5D(f)(1)"); // absent attr stays an absent key
    expect(mk[IDENTITY_KEY]).toEqual({ source_key: "crd:312360" });
    expect(mk.website).toBe("");
    expect(mk).not.toHaveProperty("WebAddrs");
  });

  it("reads gzip and plain identically", async () => {
    expect(await rowsOf(writeFeed(true))).toEqual(await rowsOf(writeFeed(false)));
  });

  it("classifies by CRD with the platform fallback", async () => {
    const [row] = (await rowsOf(writeFeed(false))) as [RawRow];
    expect(classifyRow(row)).toMatchObject({
      sourceKey: "crd:283882",
      domain: "rabenoldadvisors.com",
    });
    const platformOnly = { ...row, website: "HTTPS://WWW.LINKEDIN.COM/COMPANY/RABENOLD" };
    expect(classifyRow(platformOnly)).toMatchObject({
      domain: null,
      socialUrl: "HTTPS://WWW.LINKEDIN.COM/COMPANY/RABENOLD",
    });
  });
});
