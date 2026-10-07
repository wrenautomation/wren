import { describe, expect, it } from "vitest";
import { defineSetup, dnsChecks, parseSetupSubject, setupSubject, setupWorkflow } from "./setup.js";
import { CORE_SETUPS } from "./setups.js";
import { checkWorkflows } from "./workflows.js";

const LINE = defineSetup({
  id: "setup.line",
  name: "A line",
  blurb: "Two steps.",
  site: "domain",
  steps: [
    { id: "one", fact: "t.one", label: "One", who: "client", how: "Do one.", forYou: "We do one." },
    {
      id: "two",
      fact: "t.two",
      label: "Two",
      who: "auto",
      how: "Wait.",
      forYou: "Wait.",
      check: "t.two",
      every: "1 day",
    },
  ],
});

describe("setupWorkflow", () => {
  it("is a valid setup workflow: a line of own steps, a self wire where a step checks again", () => {
    const w = setupWorkflow(LINE);
    expect(checkWorkflows([w, ...CORE_SETUPS.map(setupWorkflow)], [])).toEqual([]);
    expect(w.kind).toBe("setup");
    expect(w.wires).toEqual([
      { from: "in.accounts", to: "one.account", via: "events" },
      { from: "one.done", to: "two.account", via: "events" },
      { from: "two.again", to: "two.account", via: "events", wait: "1 day" },
      { from: "two.done", to: "out.done", via: "events" },
    ]);
    expect(w.nodes.map((n) => n.own?.run)).toEqual(["setup.step", "setup.step"]);
  });
});

describe("setup subjects", () => {
  it("carry the account and generation; a round's suffix drops to the base", () => {
    expect(setupSubject(7, 2)).toBe("account:7:g2");
    expect(parseSetupSubject("account:7:g2#3")).toEqual({
      accountId: 7,
      gen: 2,
      base: "account:7:g2",
    });
    expect(parseSetupSubject("account:7:g2#m1700000000000")?.base).toBe("account:7:g2");
    expect(parseSetupSubject("lead:7")).toBeNull();
    expect(parseSetupSubject("account:7:g2#X")).toBeNull();
  });
});

describe("dnsChecks", () => {
  const zone: Record<string, string[]> = {
    "MX example.test": ["10 mx.example.test."],
    "TXT example.test": [
      '"v=spf1 include:_spf.example.test ~all"',
      '"google-site-verification=abc"',
    ],
    "TXT _dmarc.example.test": ['"v=DMARC1; p=none"'],
    "TXT google._domainkey.example.test": ['"v=DKIM1; k=rsa; p=MIIBIjANBgkq" "hkiG9w0BAQEF"'],
    "A example.test": ["192.0.2.1"],
    "MX ms.test": ["0 ms-test.mail.protection.outlook.com."],
    "TXT ms.test": ['"v=spf1 include:spf.protection.outlook.com -all"'],
    "TXT _dmarc.ms.test": ['"v=DMARC1; p=quarantine"'],
    "TXT selector2._domainkey.ms.test": ['"v=DKIM1; p=MIGfMA0GCSqG"'],
    "TXT selector1._domainkey.ms.test": ['"v=DKIM1; p="'],
  };
  const checks = dnsChecks(async (name, t) => zone[`${t} ${name}`] ?? []);
  const account = (ref: string) =>
    ({ id: 1, client: null, site: "domain", ref }) as Parameters<
      NonNullable<(typeof checks)["dns.answers"]>
    >[0]["account"];
  const now = new Date(0);

  it("passes a domain with MX, one SPF and DMARC, and Google's TXT", async () => {
    expect(await checks["dns.answers"]?.({ account: account("example.test"), now })).toMatchObject({
      ok: true,
    });
    expect(
      await checks["dns.mail_records"]?.({ account: account("example.test"), now }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await checks["dns.postmaster_txt"]?.({ account: account("example.test"), now }),
    ).toMatchObject({
      ok: true,
    });
  });

  it("finds DKIM at the mail host's selector; a revoked key (empty p=) isn't one", async () => {
    expect(
      await checks["dns.mail_records"]?.({ account: account("example.test"), now }),
    ).toMatchObject({ ok: true, why: "MX, SPF, DKIM and DMARC are set", seen: { dkim: "google" } });
    expect(await checks["dns.mail_records"]?.({ account: account("ms.test"), now })).toMatchObject({
      ok: true,
      seen: { dkim: "selector2" },
    });
  });

  it("names what's missing, and two SPF records", async () => {
    zone["TXT other.test"] = ['"v=spf1 a ~all"', '"v=spf1 mx ~all"'];
    expect(
      await checks["dns.mail_records"]?.({ account: account("other.test"), now }),
    ).toMatchObject({
      ok: false,
      why: "Missing MX, one SPF record (there are two), DKIM, DMARC",
    });
    expect(await checks["dns.answers"]?.({ account: account("none.test"), now })).toMatchObject({
      ok: false,
    });
  });
});
