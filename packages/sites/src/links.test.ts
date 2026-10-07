import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { goLinkOf, hopOf, linkUtm, linkWord } from "./hops.js";
import { qrMatrix, qrPath } from "./qr.js";

const hash = (m: boolean[][]) =>
  createHash("sha256")
    .update(m.map((r) => r.map((b) => (b ? 1 : 0)).join("")).join("\n"))
    .digest("hex")
    .slice(0, 16);

describe("tracked links", () => {
  it("cleans a word for a link's path", () => {
    expect(linkWord("Spring Promo!")).toBe("spring-promo");
    expect(linkWord("  120211234567890 ")).toBe("120211234567890");
    expect(linkWord("--")).toBe("");
    expect(linkWord(null)).toBe("");
    expect(linkWord("x".repeat(100))).toHaveLength(80);
  });

  it("makes a /go/ link the edge reads back to the same utm and page", () => {
    const url = goLinkOf({
      host: "portal.example.test",
      link: "ads",
      campaign: "spring",
      content: "120211234567890",
      slug: "roof-check",
    });
    expect(url).toBe("https://portal.example.test/go/ads/spring/120211234567890?to=/o/roof-check");
    const u = new URL(url);
    const hop = hopOf(u.pathname, u.searchParams);
    expect(hop).toMatchObject({
      link: "ads",
      source: "meta",
      medium: "paid",
      campaign: "spring",
      content: "120211234567890",
      slug: "roof-check",
    });
    expect(goLinkOf({ host: "h.test", link: "yt", campaign: "c", slug: "s" })).toBe(
      "https://h.test/go/yt/c?to=/o/s",
    );
  });

  it("credits an unknown short name as itself", () => {
    expect(linkUtm("podcast")).toEqual({ source: "podcast", medium: "link" });
    expect(linkUtm("li")).toEqual({ source: "linkedin", medium: "organic" });
    expect(linkUtm("gads")).toEqual({ source: "google", medium: "paid" });
    expect(linkUtm("gads", true)).toEqual({ source: "gads", medium: "link" });
  });
});

describe("QR codes", () => {
  // Each was read back by a QR decoder when written; the hash pins the modules.
  it("draws the same modules for the same text", () => {
    const one = qrMatrix("HELLO WORLD");
    expect(one).toHaveLength(21);
    expect(hash(one as boolean[][])).toBe("2d21897bf5a7ac60");
    const link = qrMatrix(
      "https://wrenautomation.com/go/ads/spring/120211234567890?to=/o/lander-speed",
    );
    expect(link).toHaveLength(37);
    expect(hash(link as boolean[][])).toBe("9a20ff7a596aad3b");
    const v7 = qrMatrix("s".repeat(120));
    expect(v7).toHaveLength(45);
    expect(hash(v7 as boolean[][])).toBe("0be5ec2c3c2c4403");
  });

  it("has its finder patterns in three corners", () => {
    const m = qrMatrix("a") as boolean[][];
    const n = m.length;
    for (const [x, y] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ] as const) {
      expect(m[y]?.[x]).toBe(true);
      expect(m[y + 1]?.[x + 1]).toBe(false);
      expect(m[y + 3]?.[x + 3]).toBe(true);
    }
  });

  it("refuses text past version 10", () => {
    expect(qrMatrix("v".repeat(213))).not.toBeNull();
    expect(qrMatrix("v".repeat(214))).toBeNull();
  });

  it("draws runs as one path, inside a quiet zone", () => {
    const d = qrPath([
      [true, true, false],
      [false, false, true],
    ]);
    expect(d).toBe("M4 4h2v1h-2zM6 5h1v1h-1z");
  });
});
