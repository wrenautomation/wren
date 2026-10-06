import { describe, expect, it } from "vitest";
import { CustomHostnames, DomainRefusal, domainState, normalHost } from "./domains.js";

const OWN = "customers.wrenautomation.com";

describe("normalHost", () => {
  it("keeps a client's subdomain, lowercased, punycoded, no trailing dot", () => {
    expect(normalHost(" Portal.Acme.example.com. ", OWN)).toBe("portal.acme.example.com");
    expect(normalHost("https://portal.acme.co.uk/", OWN)).toBe("portal.acme.co.uk");
    expect(normalHost("app.bücher.de", OWN)).toBe("app.xn--bcher-kva.de");
  });

  it("refuses apexes, our hosts, IPs, ports, logins and non-names", () => {
    for (const bad of [
      "acme.com",
      "acme.co.uk",
      "app.wrenautomation.com",
      "x.customers.wrenautomation.com",
      "1.2.3.4",
      "portal.acme.com:8443",
      "me@portal.acme.com",
      "portal acme.com",
      "localhost",
      "portal.acme.invalidtld",
      "",
    ])
      expect(() => normalHost(bad, OWN), bad).toThrow(DomainRefusal);
  });

  it("keeps a subdomain under a private suffix: the apex rule is ICANN's", () => {
    expect(normalHost("portal.acme.github.io", OWN)).toBe("portal.acme.github.io");
  });
});

describe("Cloudflare custom hostnames", () => {
  const answer = (result: unknown, success = true) =>
    new Response(
      JSON.stringify({ success, errors: success ? [] : [{ code: 1406, message: "dup" }], result }),
    );

  it("creates with HTTP validation and reads the records back", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const cf = new CustomHostnames({
      token: "t",
      zone: "z1",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return answer({
          id: "h1",
          hostname: "portal.acme.com",
          status: "pending",
          ssl: { status: "initializing" },
          ownership_verification: {
            type: "txt",
            name: "_cf-custom-hostname.portal.acme.com",
            value: "v1",
          },
        });
      }) as typeof fetch,
    });
    const made = await cf.create("portal.acme.com");
    expect(calls[0]?.url).toBe("https://api.cloudflare.com/client/v4/zones/z1/custom_hostnames");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      hostname: "portal.acme.com",
      ssl: { method: "http", type: "dv" },
    });
    expect(domainState(made, OWN)).toEqual({
      status: "pending",
      sslStatus: "initializing",
      records: {
        cname: { name: "portal.acme.com", target: OWN },
        txt: { name: "_cf-custom-hostname.portal.acme.com", value: "v1" },
      },
      problem: null,
    });
  });

  it("throws Cloudflare's error codes", async () => {
    const cf = new CustomHostnames({
      token: "t",
      zone: "z1",
      fetch: (async () => answer(null, false)) as unknown as typeof fetch,
    });
    await expect(cf.create("portal.acme.com")).rejects.toThrow(/1406 dup/);
  });
});
