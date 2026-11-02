/**
 * Postmaster Tools sync against the migrated schema (C-D15).
 *
 * A day Google later revises must overwrite, not duplicate; a domain with no
 * data must be reported rather than fail the run; one domain's failure must
 * not cost the others their read; and a refused credential must name the
 * missing scope instead of a status code.
 */
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type PostmasterClient,
  PostmasterError,
  registeredDomains,
  syncPostmaster,
} from "../../src/inbox/postmaster.js";
import { postmasterDays } from "../../src/schema.js";
import { TABLES } from "./compose-fixtures.js";

const TODAY = "2026-09-09";
const DOMAIN = "wren-automation.com";
type Stamp = [number, number, number];

/** One v2 DomainStat row: the response is FLAT, one row per metric per day. */
function stat(metric: string, [year, month, day]: Stamp, value: number, integer = false) {
  const box = integer ? { intValue: String(value) } : { doubleValue: value };
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return {
    name: `domains/x/domainStats/${metric}.${year}${mm}${dd}`,
    metric,
    date: { year, month, day },
    value: box,
  };
}

/** A full day: every metric we ask for, plus one we never requested — which must survive in `raw` (D24). */
function aDay(stamp: Stamp, opts: { spam: number; count?: number }) {
  return [
    stat("spam_rate", stamp, opts.spam),
    stat("spf_success_ratio", stamp, 1.0),
    stat("dkim_success_ratio", stamp, 1.0),
    stat("dmarc_success_ratio", stamp, 1.0),
    stat("delivery_error_rate", stamp, 0.01),
    stat("tls_inbound_count", stamp, opts.count ?? 500, true),
    stat("tls_outbound_count", stamp, 3, true),
    stat("feedback_loop_spam_rate", stamp, 0.002),
  ];
}

type Handler = (url: URL) => Response;

const client = (handler: Handler): PostmasterClient => ({
  fetch: async (url) => handler(new URL(url)),
  token: "t",
  sleep: async () => {},
});

function api(perDomain: Record<string, unknown[]>, opts: { status?: number } = {}) {
  return client((url) => {
    if (opts.status !== undefined && opts.status !== 200)
      return new Response("no", { status: opts.status });
    if (url.pathname.endsWith("/domains")) {
      return Response.json({
        domains: Object.keys(perDomain).map((d) => ({ name: `domains/${d}` })),
      });
    }
    const domain = url.pathname.split("/domains/")[1]?.split("/")[0] ?? "";
    return Response.json({ domainStats: perDomain[domain] ?? [] });
  });
}

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "postmaster_days"]));
const db = (): Db => pg.db;

const sync = (c: PostmasterClient, domains: readonly string[] = [DOMAIN]) =>
  syncPostmaster(db(), { client: c, domains, days: 7, today: TODAY });
const rows = () => db().select().from(postmasterDays).orderBy(asc(postmasterDays.day));

describe("postmaster sync", () => {
  it("a day Google revises overwrites rather than duplicating", async () => {
    await sync(api({ [DOMAIN]: aDay([2026, 9, 8], { spam: 0.0 }) }));
    await sync(api({ [DOMAIN]: aDay([2026, 9, 8], { spam: 0.004, count: 900 }) }));

    const stored = await rows();
    expect(stored.length).toBe(1);
    expect(stored[0]?.spamRate).toBeCloseTo(0.004, 10);
    expect(stored[0]?.tlsInboundCount).toBe(900);
  });

  it("v2 flat rows are pivoted into one row per day", async () => {
    const stats = await sync(
      api({
        [DOMAIN]: [...aDay([2026, 9, 7], { spam: 0.001 }), ...aDay([2026, 9, 8], { spam: 0.002 })],
      }),
    );

    expect(stats.days_with_data).toBe(2);
    const stored = await rows();
    expect(stored.map((r) => r.day)).toEqual(["2026-09-07", "2026-09-08"]);
    expect(stored.map((r) => r.spamRate)).toEqual([0.001, 0.002]);
    expect(stored.every((r) => r.dmarcSuccessRatio === 1)).toBe(true);
  });

  it("a count stays an integer", async () => {
    // v2 sends int64 as a STRING; through a float it would print as 500.0.
    await sync(api({ [DOMAIN]: aDay([2026, 9, 8], { spam: 0.0, count: 12345 }) }));
    const [row] = await rows();
    expect(row?.tlsInboundCount).toBe(12345);
    expect(Number.isInteger(row?.tlsInboundCount)).toBe(true);
    expect(row?.tlsOutboundCount).toBe(3);
  });

  it("v2 never writes over the reputation v1 left behind", async () => {
    await db()
      .insert(postmasterDays)
      .values({
        domain: DOMAIN,
        day: "2026-09-08",
        spamRate: 0.0,
        domainReputation: "HIGH",
        raw: { v1: true },
      });

    await sync(api({ [DOMAIN]: aDay([2026, 9, 8], { spam: 0.004 }) }));

    const [row] = await rows();
    expect(row?.spamRate).toBeCloseTo(0.004, 10); // the new numbers landed
    expect(row?.domainReputation).toBe("HIGH"); // and the old one survived
  });

  it("a metric we never asked for is kept, not discarded", async () => {
    await sync(api({ [DOMAIN]: aDay([2026, 9, 8], { spam: 0.0 }) }));
    const [row] = await rows();
    const raw = (row?.raw ?? {}) as { domainStats?: { metric: string }[] };
    const kept = new Set((raw.domainStats ?? []).map((r) => r.metric));
    expect(kept.has("feedback_loop_spam_rate")).toBe(true); // no column, still stored (D24)
  });

  it("one domain failing is recorded and the others are still read", async () => {
    const c = client((url) => {
      const domain = url.pathname.split("/domains/")[1]?.split("/")[0] ?? "";
      if (domain === "broken.example") return new Response("no", { status: 404 });
      return Response.json({ domainStats: aDay([2026, 9, 8], { spam: 0.0 }) });
    });

    const stats = await sync(c, ["broken.example", DOMAIN]);

    expect([stats.domains, stats.stored]).toEqual([1, 1]); // the one after it was read
    expect(stats.domains_failed).toBe(1);
    expect(stats.failed["broken.example"]).toContain("no such registered domain");

    await expect(
      sync(api({}, { status: 404 }), ["broken.example", "also-broken.example"]),
    ).rejects.toThrow(/no such registered domain/);
  });

  it("a row without a date is counted rather than lost", async () => {
    const undated = { metric: "spam_rate", date: {}, value: { doubleValue: 0.5 } };
    const stats = await sync(api({ [DOMAIN]: [...aDay([2026, 9, 8], { spam: 0.0 }), undated] }));
    expect(stats.rows_unparseable).toBe(1);
    expect(stats.days_with_data).toBe(1);
  });

  it("a domain with no data is reported, not an error", async () => {
    const stats = await sync(api({ [DOMAIN]: [] }), [DOMAIN, "wrenautomation.net"]);
    expect(stats.days_without_data).toBe(2);
    expect(stats.days_with_data).toBe(0);
    expect(stats.stored).toBe(0);
  });

  const ACTIVATION_URL =
    "https://console.developers.google.com/apis/api/gmailpostmastertools.googleapis.com/overview?project=878508723498";

  /** Google's real 403 when the API was never switched on for the key's Cloud project. */
  const disabledApi = () =>
    client(() =>
      Response.json(
        {
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "Gmail Postmaster Tools API has not been used in project ...",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "SERVICE_DISABLED",
                domain: "googleapis.com",
                metadata: { activationUrl: ACTIVATION_URL },
              },
            ],
          },
        },
        { status: 403 },
      ),
    );

  it("a disabled API is not reported as a refused credential", async () => {
    const raised = await sync(disabledApi()).catch((err: unknown) => err);
    expect(raised).toBeInstanceOf(PostmasterError);
    const message = String((raised as Error).message);
    expect(message).toContain("not enabled");
    expect(message).toContain("the credential and its scope are fine");
    expect(message).toContain(ACTIVATION_URL); // Google's own link, never a hand-built one
    expect(message).not.toContain("domain-wide-delegation");
  });

  it("a refused credential names the scope to add", async () => {
    const raised = await sync(api({}, { status: 403 })).catch((err: unknown) => err);
    expect(raised).toBeInstanceOf(PostmasterError);
    const message = String((raised as Error).message);
    expect(message).toContain("postmaster.traffic.readonly"); // the narrow scope, named first
    expect(message).toContain("domain-wide-delegation");
    expect(message).toContain("postmaster.readonly");
    expect(message).toContain("v1");
  });

  it("registeredDomains reads the console registration", async () => {
    const c = api({ [DOMAIN]: [], "wrenautomation.net": [] });
    expect(await registeredDomains(c)).toEqual([DOMAIN, "wrenautomation.net"]);
  });
});
