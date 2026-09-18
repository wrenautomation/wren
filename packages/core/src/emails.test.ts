import { describe, expect, it } from "vitest";
import {
  emailDomain,
  emailSyntaxError,
  extractDomain,
  isFreemail,
  isPlatformDomain,
  isRoleLocalpart,
  normalizeEmail,
  validDomain,
} from "./emails.js";

describe("normalizeEmail", () => {
  it.each([
    ["  Jane@Foo.COM ", "jane@foo.com"],
    ["mailto:jane@foo.com", "jane@foo.com"],
    ["<jane@foo.com>", "jane@foo.com"],
  ])("%s -> %s", (raw, expected) => expect(normalizeEmail(raw)).toBe(expected));
});

describe("emailSyntaxError", () => {
  it.each(["jane@foo.com", "jane.doe+tag@foo-bar.co.uk", "o'brien@foo.com", "j@f.io"])(
    "accepts %s",
    (email) => expect(emailSyntaxError(email)).toBeNull(),
  );
  it.each([
    ["janefoo.com", "exactly one @"],
    ["jane@@foo.com", "exactly one @"],
    ["@foo.com", "empty local"],
    [`${"a".repeat(65)}@foo.com`, "64"],
    [".jane@foo.com", "dot"],
    ["jane.@foo.com", "dot"],
    ["ja..ne@foo.com", "dot"],
    ["ja ne@foo.com", "illegal character"],
    ["jane@foo", "invalid domain"],
    ["jane@-foo.com", "invalid domain"],
    ["jane@foo.c", "invalid domain"],
    ["jane@foo.123", "invalid domain"],
    [`jane@${"a".repeat(250)}.com`, "254"],
  ])("rejects %s", (email, fragment) => expect(emailSyntaxError(email)).toContain(fragment));
});

describe("domains", () => {
  it.each([
    ["foo.com", "foo.com"],
    ["www.foo.com", "foo.com"],
    ["https://www.foo.com/about?x=1#top", "foo.com"],
    ["http://foo.co.uk", "foo.co.uk"],
    ["FOO.com/", "foo.com"],
    ["foo.com:8080", "foo.com"],
    ["foo.com.", "foo.com"],
    ["https://user@foo.com/path", "foo.com"],
  ])("extracts %s", (raw, expected) => expect(extractDomain(raw)).toBe(expected));
  it.each(["", "  ", "N/A", "-", "foo", "foo_bar.com", "https://"])("garbage %j is null", (raw) =>
    expect(extractDomain(raw)).toBeNull(),
  );
  it("requires an alphabetic or punycode TLD", () => {
    expect(validDomain("foo.com")).toBe(true);
    expect(validDomain("foo.123")).toBe(false);
    expect(validDomain("xn--mnchen-3ya.de")).toBe(true);
    expect(validDomain("xn--e1afmkfd.xn--p1ai")).toBe(true);
    expect(validDomain("foo.xn--")).toBe(false);
    expect(extractDomain("https://www.xn--mnchen-3ya.de/kontakt")).toBe("xn--mnchen-3ya.de");
    expect(emailSyntaxError("jane@xn--mnchen-3ya.de")).toBeNull();
  });
  it("emailDomain", () => expect(emailDomain("jane@foo.co.uk")).toBe("foo.co.uk"));
  it("platform domains match by suffix, parents of hosted media do not", () => {
    for (const d of [
      "linkedin.com",
      "uk.linkedin.com",
      "maps.google.com",
      "vimeo.com",
      "open.spotify.com",
      "blackstone.podbean.com",
      "podcasts.apple.com",
      "soundcloud.com",
    ]) {
      expect(isPlatformDomain(d), d).toBe(true);
    }
    for (const d of ["spotify.com", "apple.com", "evil-linkedin.com", "acmewealth.com"]) {
      expect(isPlatformDomain(d), d).toBe(false);
    }
    expect(isPlatformDomain("x.clutch.co", ["clutch.co"])).toBe(true);
  });
  it("freemail incl. consumer ISPs, case-blind", () => {
    for (const d of [
      "gmail.com",
      "GMAIL.com",
      "frontier.com",
      "windstream.net",
      "rr.com",
      "suddenlink.net",
      "midconetwork.com",
    ]) {
      expect(isFreemail(d), d).toBe(true);
    }
    expect(isFreemail("wrenautomation.com")).toBe(false);
  });
  it("role localparts, plus-tags stripped, bare words never", () => {
    expect(isRoleLocalpart("info@x.com")).toBe(true);
    expect(isRoleLocalpart("Hello+web@X.com")).toBe(true);
    expect(isRoleLocalpart("jane.roe@x.com")).toBe(false);
    expect(isRoleLocalpart("info")).toBe(false);
    expect(isRoleLocalpart("")).toBe(false);
  });
});
