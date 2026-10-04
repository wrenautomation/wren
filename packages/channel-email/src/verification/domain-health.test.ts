/** Domain standing: each list's listed / clear / refused answers (refused is never clear), each DNS check failing, the line and problems. */
import { describe, expect, it } from "vitest";
import {
  type DomainResolver,
  type DomainTarget,
  domainLine,
  domainProblems,
  domainStanding,
  namedDomains,
  readListAnswer,
} from "./domain-health.js";

interface Zone {
  a?: Record<string, string[]>;
  ptr?: Record<string, string[]>;
  ns?: Record<string, string[]>;
  mx?: Record<string, { exchange: string; priority: number }[]>;
  txt?: Record<string, string[][]>;
  /** Hosts whose lookup times out. */
  failing?: string[];
}

const fail = (code: string) => Promise.reject(Object.assign(new Error(code), { code }));
const resolver = (zone: Zone): DomainResolver => {
  const look = <T>(table: Record<string, T> | undefined, host: string): Promise<T> => {
    if (zone.failing?.includes(host)) return fail("ETIMEOUT");
    const r = table?.[host];
    return r === undefined ? fail("ENOTFOUND") : Promise.resolve(r);
  };
  return {
    resolve4: (h) => look(zone.a, h),
    reverse: (ip) => look(zone.ptr, ip),
    resolveNs: (h) => look(zone.ns, h),
    resolveMx: (h) => look(zone.mx, h),
    resolveTxt: (h) => look(zone.txt, h),
  };
};

const D = "example.com";
const target: DomainTarget = { domain: D, fleet: true, dkimSelector: "google", smtpHost: null };
const healthy: Zone = {
  ns: { [D]: ["ns-1.awsdns-01.org.", "ns-2.awsdns-02.com"] },
  mx: { [D]: [{ exchange: "mx.example.com", priority: 10 }] },
  txt: {
    [D]: [["v=spf1 include:_spf.example.net ~all"], ["site-verification=abc"]],
    [`_dmarc.${D}`]: [["v=DMARC1; p=none"]],
    [`google._domainkey.${D}`]: [["v=DKIM1; k=rsa; ", "p=MIIB"]],
  },
};
const standing = async (zone: Zone, t: Partial<DomainTarget> = {}) =>
  domainStanding({ ...target, ...t }, resolver({ ...healthy, ...zone }));

describe("readListAnswer", () => {
  it("DBL: 127.0.1.2-255 list, 127.255.255.x is a refused lookup", () => {
    expect(readListAnswer("dbl", "127.0.1.2")).toBe("listed");
    expect(readListAnswer("dbl", "127.0.1.255")).toBe("listed");
    expect(readListAnswer("dbl", "127.255.255.254")).toBe("refused");
    expect(readListAnswer("dbl", "127.0.1.1")).toBeNull();
    expect(readListAnswer("dbl", "127.0.0.2")).toBeNull();
  });
  it("SURBL: 127.0.0.1 refused, any other 127.0.0.x listed", () => {
    expect(readListAnswer("surbl", "127.0.0.1")).toBe("refused");
    expect(readListAnswer("surbl", "127.0.0.2")).toBe("listed");
    expect(readListAnswer("surbl", "127.0.0.64")).toBe("listed");
  });
  it("URIBL: 127.0.0.1 refused, the 2/4/8 bits listed", () => {
    expect(readListAnswer("uribl", "127.0.0.1")).toBe("refused");
    for (const a of ["127.0.0.2", "127.0.0.4", "127.0.0.8", "127.0.0.14"])
      expect(readListAnswer("uribl", a)).toBe("listed");
    expect(readListAnswer("uribl", "127.0.0.16")).toBeNull();
  });
  it("an answer outside 127/8 means nothing", () =>
    expect(readListAnswer("surbl", "10.0.0.2")).toBeNull());
});

describe("domainStanding", () => {
  it("a healthy fleet domain: the digest line says ok", async () => {
    const h = await standing({});
    expect(domainProblems(h)).toEqual([]);
    expect(domainLine(h)).toBe(
      "example.com ok (dbl, surbl, uribl clear; spf, dkim, dmarc, mx ok; ns route53)",
    );
  });

  it("a DBL listing warns; a refused and a timed-out list read not checked, not clear", async () => {
    const h = await standing({
      a: { [`${D}.dbl.spamhaus.org`]: ["127.0.1.2"], [`${D}.multi.surbl.org`]: ["127.0.0.1"] },
      failing: [`${D}.multi.uribl.com`],
    });
    expect(h.lists).toEqual({ dbl: "listed", surbl: "not checked", uribl: "not checked" });
    expect(domainProblems(h)).toEqual(["example.com listed on dbl.spamhaus.org"]);
    expect(domainLine(h)).toBe(
      "example.com warning (dbl listed; surbl, uribl not checked; spf, dkim, dmarc, mx ok; ns route53)",
    );
  });

  it("SURBL and URIBL listings; a refused DBL is not a problem", async () => {
    const h = await standing({
      a: {
        [`${D}.dbl.spamhaus.org`]: ["127.255.255.254"],
        [`${D}.multi.surbl.org`]: ["127.0.0.8"],
        [`${D}.multi.uribl.com`]: ["127.0.0.4"],
      },
    });
    expect(h.lists).toEqual({ dbl: "not checked", surbl: "listed", uribl: "listed" });
    expect(domainProblems(h)).toEqual(["example.com listed on multi.surbl.org, multi.uribl.com"]);
  });

  it("nothing published: no NS, MX, SPF, DMARC or DKIM, each a problem", async () => {
    const h = await domainStanding(target, resolver({}));
    expect(domainProblems(h)).toEqual([
      "example.com NS is missing, not Route 53",
      "example.com has 0 SPF records, not one",
      "example.com has no DKIM key at google._domainkey",
      "example.com has 0 DMARC records, not one",
      "example.com has no MX",
    ]);
    expect(domainLine(h)).toBe(
      "example.com warning (dbl, surbl, uribl clear; spf, dkim, dmarc, mx failed; ns none)",
    );
  });

  it("two SPF records, two DMARC records, a fleet domain off Route 53, DKIM at its own selector", async () => {
    const h = await standing(
      {
        ns: { [D]: ["a.ns.example.net"] },
        txt: {
          [D]: [["v=spf1 -all"], ["v=spf1 include:example.net ~all"]],
          [`_dmarc.${D}`]: [["v=DMARC1; p=none"], ["v=DMARC1; p=reject"]],
          [`s1._domainkey.${D}`]: [["v=DKIM1; p=MIIB"]],
        },
      },
      { dkimSelector: "s1" },
    );
    expect(domainProblems(h)).toEqual([
      "example.com NS is a.ns.example.net, not Route 53",
      "example.com has 2 SPF records, not one",
      "example.com has 2 DMARC records, not one",
    ]);
  });

  it("the main site: its NS set is reported, never a problem; no selector skips DKIM", async () => {
    const h = await standing(
      { ns: { [D]: ["b.ns.example.net", "a.ns.example.net"] } },
      { fleet: false, dkimSelector: null },
    );
    expect(domainProblems(h)).toEqual([]);
    expect(domainLine(h)).toBe(
      "example.com ok (dbl, surbl, uribl clear; spf, dmarc, mx ok; ns a.ns.example.net, b.ns.example.net)",
    );
  });

  it("an SMTP host's IP goes through the IP lists", async () => {
    const h = await standing(
      {
        a: {
          "smtp.example.net": ["192.0.2.25"],
          "25.2.0.192.bl.spamcop.net": ["127.0.0.2"],
        },
      },
      { smtpHost: "smtp.example.net" },
    );
    expect(domainProblems(h)).toEqual(["192.0.2.25 (smtp.example.net) listed on bl.spamcop.net"]);
    expect(domainLine(h)).toMatch(/; smtp 192.0.2.25 listed on bl.spamcop.net\)$/);
    const gone = await standing({}, { smtpHost: "gone.example.net" });
    expect(domainProblems(gone)).toEqual(["SMTP host gone.example.net does not resolve"]);
  });
});

describe("namedDomains", () => {
  it("domains a signature mentions, lowercased, once each", () =>
    expect(
      namedDomains(
        "--\nJ.R. Doe, Example Inc.\nExample.com{page}\nj@mail.example.org, example.com",
      ),
    ).toEqual(["example.com", "mail.example.org"]));
});
