/** Shopify Partners pages -> rows: listing cards, profile enrichment, slug-key fallback when the profile isn't fetched. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintedIdentity, type RawRow } from "@wren/core";
import { describe, expect, it } from "vitest";
import { listingSlugs, looksLikeProfile, ShopifyPagesSource } from "./shopify-pages.js";

const card = (name: string, slug: string) => `
<div data-component-name="listing-profile-card" class="mb-4 bg-white">
 <a href="https://www.shopify.com/partners/directory/partner/${slug}">
  <span>${name}</span><span>5.0</span><span>(25)</span>
  <span>San Diego, United States</span>
  <span>Price range for services</span><span>Starting from $1500</span>
  <span>Services</span>
  <span>Store build or redesign, Store migration&nbsp;<span>+ 31 more</span></span>
 </a>
</div>`;

const PROFILE = `
<html><body>
<span>Plus tier</span><h1>JadePuma</h1><span>Service partner</span>
<span>5.0</span><span>( 25 )</span><span>Partner since September 2018</span>
<h2>Contact information</h2><a href="https://jadepuma.com/">jadepuma.com</a>
<a href="mailto:shopify@jadepuma.com">shopify@jadepuma.com</a>
<span>Primary location</span><span>San Diego</span>, <span>United States</span>
<h2>Business description</h2>
<p>Prose mentioning partners/directory and stray@wrong.example must not win.</p>
</body></html>`;

function makeTree(opts: { withProfile: boolean; profile?: string }) {
  const tmp = mkdtempSync(join(tmpdir(), "shopify-"));
  const listingDir = join(tmp, "data", "agencies", "shopify", "store_setup");
  mkdirSync(listingDir, { recursive: true });
  writeFileSync(
    join(listingDir, "Page 1 - Hire Shopify Experts.html"),
    `<html><body>${card("JadePuma", "jadepuma")}${card("It Geeks", "it-geeks")}</body></html>`,
  );
  const profiles = join(tmp, "data", "agencies", "bulk", "shopify-partner-profiles");
  if (opts.withProfile) {
    mkdirSync(profiles, { recursive: true });
    writeFileSync(join(profiles, "jadepuma.html"), opts.profile ?? PROFILE);
  }
  return { tmp, listingDir, profiles };
}
const rowsOf = (path: string) => [...new ShopifyPagesSource(path).rows()];

describe("ShopifyPagesSource", () => {
  it("reads the listing card fields", () => {
    const { listingDir } = makeTree({ withProfile: false });
    const rows = rowsOf(listingDir);
    expect(rows.map((r) => r["Company Name"])).toEqual(["JadePuma", "It Geeks"]);
    expect(rows[0]).toMatchObject({
      "Profile URL": "https://www.shopify.com/partners/directory/partner/jadepuma",
      Rating: "5.0",
      Reviews: "25",
      Location: "San Diego, United States",
      "Price Range": "Starting from $1500",
      Services: "Store build or redesign, Store migration",
      Category: "store_setup",
    });
  });

  it("falls back to a slug key while the profile is unfetched", () => {
    const { listingDir } = makeTree({ withProfile: false });
    const row = rowsOf(listingDir)[0] as RawRow;
    expect(row.Website).toBe("");
    expect(mintedIdentity(row)).toBe("shopify:jadepuma");
  });

  it("takes website, email and tier from a fetched profile", () => {
    const { listingDir } = makeTree({ withProfile: true });
    const [enriched, bare] = rowsOf(listingDir) as [RawRow, RawRow];
    expect(enriched).toMatchObject({
      Website: "jadepuma.com",
      "Directory Email": "shopify@jadepuma.com",
      "Partner Tier": "Plus",
      "Partner Since": "September 2018",
    });
    expect(mintedIdentity(enriched)).toBeNull(); // the real domain keys the row now
    expect(enriched).not.toHaveProperty("email"); // stays a company row
    expect(mintedIdentity(bare)).toBe("shopify:it-geeks");
  });

  it("finds the tier even after the description cut", () => {
    const profile = `${PROFILE.replace("<span>Plus tier</span>", "")}<h3>Platinum Partner</h3><span>Partners are tiered based on factors</span>`;
    const { listingDir } = makeTree({ withProfile: true, profile });
    expect(rowsOf(listingDir)[0]?.["Partner Tier"]).toBe("Platinum");
  });

  it("harvests deduped slugs for the profile fetch", () => {
    const { listingDir } = makeTree({ withProfile: false });
    const other = join(listingDir, "..", "website_audit");
    mkdirSync(other);
    writeFileSync(join(other, "Page 1.html"), card("JadePuma", "jadepuma"));
    const pages = [
      join(listingDir, "Page 1 - Hire Shopify Experts.html"),
      join(other, "Page 1.html"),
    ];
    expect(listingSlugs(pages)).toEqual(["it-geeks", "jadepuma"]);
  });

  it("tells a profile from a challenge page that echoes the URL", () => {
    expect(looksLikeProfile(PROFILE)).toBe(true);
    expect(looksLikeProfile("<html>Attention Required! | Cloudflare</html>")).toBe(false);
    expect(
      looksLikeProfile(
        '<meta http-equiv="refresh" content="0; url=/partners/directory/partner/jadepuma">Checking your browser',
      ),
    ).toBe(false);
  });

  it("refuses wrong files instead of an empty batch", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "shopify-")), "store_setup");
    mkdirSync(dir);
    writeFileSync(join(dir, "Page 1.html"), "<p>not a partners listing</p>");
    expect(() => rowsOf(dir)).toThrow(/no partner cards/);
  });
});
