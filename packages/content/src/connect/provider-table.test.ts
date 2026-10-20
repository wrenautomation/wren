/**
 * `platforms.ts` has no imports (the portal Worker reads it), so its URLs sit beside
 * autobrowse's provider table. The two must agree: the sign-in link and the token calls read the
 * piece's table, the page and the tests read this one.
 */
import { OAUTH_PROVIDERS, SOCIAL_PROVIDER } from "@wrenautomation/autobrowse/oauth";
import { describe, expect, it } from "vitest";
import { SOCIAL, SOCIAL_PLATFORMS } from "./platforms.js";

describe("platform table against autobrowse's provider table", () => {
  it("both name the same eight platforms", () => {
    expect(Object.keys(SOCIAL_PROVIDER).sort()).toEqual([...SOCIAL_PLATFORMS].sort());
  });

  it.each(SOCIAL_PLATFORMS)("%s: authorize, token and pkce agree", (p) => {
    const piece = OAUTH_PROVIDERS[SOCIAL_PROVIDER[p]];
    expect({
      authorize: SOCIAL[p].authorize,
      token: SOCIAL[p].token,
      pkce: SOCIAL[p].pkce,
    }).toEqual({ authorize: piece.authorize, token: piece.token, pkce: piece.pkce });
  });

  it.each(SOCIAL_PLATFORMS)("%s: scopes are set, so the link always carries them", (p) => {
    expect(SOCIAL[p].scopes.length).toBeGreaterThan(0);
  });
});
