/** Saved Clutch pages -> rows: card fields, redirect unwrapping, sponsored fallback to slug keys, provenance. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintedIdentity, type RawRow } from "@wren/core";
import { beforeEach, describe, expect, it } from "vitest";
import { ClutchPagesSource } from "./clutch-pages.js";

function card(name: string, slug: string, destination: string, sponsor = "false"): string {
  const redirect =
    "https://r.clutch.co/redirect?category=Design&amp;" +
    "from_page=https%3A%2F%2Fclutch.co%2Fus%2Fagencies%2Fdesign%3Fsort_by%3DClutchRank" +
    `&amp;is_sponsor=${sponsor}&amp;u=${destination}`;
  return `
<div class="provider-row provider-row--featured" data-position="1">
  <a href="https://clutch.co/profile/${slug}" class="sg-provider-logotype provider__logotype"
     ><img alt="${name} logo"></a>
  <h3 class="provider__title">
    <a href="https://clutch.co/profile/${slug}" title="See ${name} Profile"
       class="provider__title-link directory_profile">${name}</a>
  </h3>
  <span class="sg-rating__number">4.8</span>
  <a href="https://clutch.co/profile/${slug}#reviews" class="sg-rating__reviews">72 reviews</a>
  <span class="badge">Premier Verified</span>
  <span>$25,000+</span><span>$150 - $199 / hr</span><span>10 - 49</span>
  <span>Pittsburgh, PA</span>
  <span>Services provided</span>
  <span>40% Web Design</span><span>30% Web Development</span>
  <p>A long description, with commas, which must never be read as a location.</p>
  <a class="provider__cta-link" href="https://clutch.co/profile/${slug}">View Profile</a>
  <a class="provider__cta-link website-link" href="${redirect}">Visit Website</a>
</div>`;
}

const FOOTER = "<footer><span>Made in Washington, DC</span><span>$0+</span></footer>";
const PPC = "https%3A%2F%2Fppc.clutch.co%2Fppc%2Fclick%2F%3Fs%3Dxyz";

function writePage(directory: string, fileName: string, ...cards: string[]) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), `<html><body>${cards.join("")}${FOOTER}</body></html>`);
}

const rowsOf = (path: string) => [...new ClutchPagesSource(path).rows()];

let tmp: string;
let categoryDir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "clutch-"));
  categoryDir = join(tmp, "design_agencies");
  writePage(
    categoryDir,
    "Page 1 - Top Design Agencies.html",
    card("Huemor", "huemor", "https%3A%2F%2Fhuemor.rocks%2F%3Futm_source%3Dclutch"),
    card("AdShop", "adshop", PPC, "true"),
  );
  writePage(
    categoryDir,
    "Page 2 - Top Design Agencies.html",
    card("Cake &amp; Arrow", "cake-arrow", "https%3A%2F%2Fcakeandarrow.com%2F"),
  );
});

describe("ClutchPagesSource", () => {
  it("reads cards across pages with provenance columns", () => {
    const rows = rowsOf(categoryDir);
    expect(rows.map((r) => r["Company Name"])).toEqual(["Huemor", "AdShop", "Cake & Arrow"]);
    expect(rows.map((r) => r.Page)).toEqual(["1", "1", "2"]);
    expect(rows.map((r) => r.Position)).toEqual(["1", "2", "1"]);
    expect(rows.every((r) => r.Category === "design_agencies")).toBe(true);
    expect(String(rows[0]?.["Source File"])).toMatch(/^Page 1/);
    expect(String(rows[0]?.["Listing URL"])).toMatch(/^https:\/\/clutch\.co\/us\/agencies\/design/);
  });

  it("reads an organic card's fields and website", () => {
    const row = rowsOf(categoryDir)[0] as RawRow;
    expect(row.Website).toBe("https://huemor.rocks/"); // utm junk stripped
    expect(row["Profile URL"]).toBe("https://clutch.co/profile/huemor");
    expect(row).toMatchObject({
      "Min. Project Size": "$25,000+",
      "Avg. Hourly Rate": "$150 - $199 / hr",
      "Company Size": "10 - 49",
      Rating: "4.8",
      Reviews: "72",
      Location: "Pittsburgh, PA",
      Services: "40% Web Design, 30% Web Development",
      Verification: "Premier Verified",
      Sponsored: "",
      "agency.min_budget": "$25,000+", // facts prepended for the view
      "agency.team_size": "10 - 49",
    });
    expect(mintedIdentity(row)).toBeNull(); // the real domain is the identity
  });

  it("keys a sponsored card by slug, never by the PPC tracker", () => {
    const sponsored = rowsOf(categoryDir)[1] as RawRow;
    expect(sponsored.Website).toBe("");
    expect(sponsored.Sponsored).toBe("yes");
    expect(mintedIdentity(sponsored)).toBe("clutch:adshop");
    expect(sponsored.website).toBe("https://clutch.co/profile/adshop"); // rides as social_url
  });

  it("never lets footer tokens bleed into the last card", () => {
    expect(rowsOf(categoryDir).at(-1)?.Location).toBe("Pittsburgh, PA");
  });

  it("accepts a single file; the parent dir still names the category", () => {
    const rows = rowsOf(join(categoryDir, "Page 1 - Top Design Agencies.html"));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.Category).toBe("design_agencies");
  });

  it("refuses an empty directory loudly", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    expect(() => new ClutchPagesSource(empty)).toThrow(/no \.html files/);
  });

  it("hashes the bytes, not the path", () => {
    const first = new ClutchPagesSource(categoryDir).contentHash;
    writePage(categoryDir, "Page 3 - Top Design Agencies.html", card("New", "new", "x"));
    expect(new ClutchPagesSource(categoryDir).contentHash).not.toBe(first);
  });

  it("recovers a spotlight card's profile URL from the reviews anchor", () => {
    const redirect =
      "https://r.clutch.co/redirect?is_sponsor=true&amp;u=https%3A%2F%2Fppc.clutch.co%2Fppc%2Fclick%2F%3Fs%3Dabc";
    const spotlight = `
<div class="provider-row provider-row--spotlight">
  <h3 class="provider__title">
    <a href="${redirect}" title="See Olive Profile" class="provider__title-link">Olive &amp; Company</a>
  </h3>
  <a href="https://clutch.co/profile/olive-company#reviews">12 reviews</a>
  <span>$10,000+</span><span>2 - 9</span><span>Minneapolis, MN</span>
  <a class="provider__cta-link" href="https://clutch.co/profile/olive-company">View Profile</a>
</div>`;
    const dir = join(tmp, "spot");
    writePage(dir, "Page 1.html", spotlight);
    const [row] = rowsOf(dir) as [RawRow];
    expect(row["Profile URL"]).toBe("https://clutch.co/profile/olive-company");
    expect(row.Website).toBe("");
    expect(row.Sponsored).toBe("yes");
    expect(mintedIdentity(row)).toBe("clutch:olive-company");
  });

  it("gives the same firm sponsored and organic one identity", () => {
    const dir = join(tmp, "fork");
    writePage(
      dir,
      "Page 1.html",
      card("GLIDE", "glide", PPC, "true"),
      card("GLIDE", "glide", "https%3A%2F%2Fglidedesign.com%2F"),
    );
    const rows = rowsOf(dir);
    expect(rows.map((r) => r.Website)).toEqual([
      "https://glidedesign.com/",
      "https://glidedesign.com/",
    ]);
    expect(rows.every((r) => mintedIdentity(r) === null)).toBe(true);
  });

  it("backfills websites across sibling category directories", () => {
    writePage(join(tmp, "seo"), "Page 1.html", card("GLIDE", "glide", PPC, "true"));
    writePage(
      join(tmp, "design"),
      "Page 1.html",
      card("GLIDE", "glide", "https%3A%2F%2Fglidedesign.com%2F"),
    );
    const [row] = rowsOf(join(tmp, "seo")) as [RawRow];
    expect(row.Website).toBe("https://glidedesign.com/");
    expect(mintedIdentity(row)).toBeNull();
  });

  it("refuses a non-html single file", () => {
    const csv = join(tmp, "snapshot.csv");
    writeFileSync(csv, "Company Name,Website\nAcme,acme.com\n");
    expect(() => new ClutchPagesSource(csv)).toThrow(/not a saved \.html page/);
  });

  it("refuses html with no cards at iteration", () => {
    const dir = join(tmp, "wrong");
    writePage(dir, "Page 1.html", "<p>a saved page from the wrong site</p>");
    expect(() => rowsOf(dir)).toThrow(/no provider cards/);
  });
});
