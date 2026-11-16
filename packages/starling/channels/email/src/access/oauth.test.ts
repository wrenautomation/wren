// Wren's mail apps' OAuth, pure parts: what a grant lets Wren do, and claims of junk. Links,
// tokens, refusals and the consent check are pinned in oauth.wire.test.ts.
import {
  accessOf,
  claimsOf,
  GMAIL_READ,
  GMAIL_SEND,
  graphScopes,
} from "@wrenautomation/autobrowse/oauth";
import { describe, expect, it } from "vitest";

describe("scopes", () => {
  it("what a grant lets Wren do", () => {
    expect(accessOf("google", [GMAIL_SEND])).toBe("send");
    expect(accessOf("google", [GMAIL_READ, GMAIL_SEND])).toBe("read");
    expect(accessOf("google", [GMAIL_READ])).toBeNull();
    expect(accessOf("microsoft", graphScopes("Mail.Read Mail.Send openid"))).toBe("read");
    expect(accessOf("microsoft", graphScopes("mail.send"))).toBe("send");
  });
});

describe("tokens", () => {
  it("claims of junk are empty", () => {
    expect(claimsOf("x")).toEqual({});
    expect(claimsOf(undefined)).toEqual({});
    expect(claimsOf("a.!!!.b")).toEqual({});
  });
});
