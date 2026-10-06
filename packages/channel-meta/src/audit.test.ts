import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { type AdRow, type AdSetRow, metaAds } from "./ads.js";
import {
  audit,
  auditSettingsSchema,
  coldStart,
  type Evidence,
  gatherEvidence,
  score,
} from "./audit.js";

const NOW = "2026-10-06T12:00:00.000Z";
const S = auditSettingsSchema.parse({});

const SET: AdSetRow = {
  id: "s1",
  campaign_id: "c1",
  effective_status: "ACTIVE",
  optimization_goal: "LEAD_GENERATION",
  daily_budget: "2000",
  learning_stage_info: { status: "SUCCESS" },
};
const ADS: AdRow[] = ["SHARE", "VIDEO", "SHARE"].map((t, i) => ({
  id: `a${i}`,
  adset_id: "s1",
  effective_status: "ACTIVE",
  creative: { id: `cr${i}`, object_type: t, url_tags: "utm_source=meta" },
}));

/** A warm account with one live campaign, its ad set and three ads. */
function warm(over: Partial<Evidence> = {}): Evidence {
  return {
    now: NOW,
    account: {
      id: "act_1",
      account_status: 1,
      amount_spent: "120000",
      created_time: "2025-01-01T00:00:00Z",
    },
    campaigns: [{ id: "c1", name: "c", status: "ACTIVE", objective: "OUTCOME_LEADS" }],
    adsets: [SET],
    ads: ADS,
    pixels: [{ id: "p1", last_fired_time: "2026-10-05T00:00:00Z" }],
    recent: [{ spend: "130.00", impressions: "9000" }],
    matured: [{ actions: [{ action_type: "lead", value: "12" }] }],
    errors: {},
    ...over,
  };
}

describe("coldStart", () => {
  it("judges each dimension from its own evidence", () => {
    expect(coldStart(warm())).toMatchObject({ account: "warm", pixel: "warm", conversion: "warm" });
    const fresh = coldStart(
      warm({
        account: { id: "act_1", amount_spent: "0" },
        recent: [],
        pixels: [{ id: "p1" }],
        matured: [],
      }),
    );
    expect(fresh).toMatchObject({ account: "cold", pixel: "cold", conversion: "cold" });
  });

  it("keeps unknown when evidence is missing or contradicts itself", () => {
    const none = coldStart(warm({ account: null, pixels: null, matured: null }));
    expect(none).toMatchObject({ account: "unknown", pixel: "unknown", conversion: "unknown" });
    // a new account does not prove a new pixel, and zero spend with impressions is contradictory
    const odd = coldStart(warm({ account: { id: "act_1", amount_spent: "0" } }));
    expect(odd.account).toBe("unknown");
    expect(odd.pixel).toBe("warm");
  });
});

describe("audit", () => {
  it("a healthy warm account passes everything and is graded", () => {
    const a = audit(warm(), S);
    expect(a.controls.filter((c) => c.state !== "pass" && c.state !== "not_applicable")).toEqual(
      [],
    );
    expect(a.health).toBe(100);
    expect(a.grade).toBe("graded");
    expect(a.drafts).toEqual([]);
  });

  it("fails what is wrong and drafts a fix for each, writing nothing", () => {
    const e = warm();
    e.adsets = [
      {
        ...SET,
        optimization_goal: "LINK_CLICKS",
        learning_stage_info: { status: "FAIL" },
      },
    ];
    e.ads = [
      {
        ...(ADS[0] as AdRow),
        effective_status: "DISAPPROVED",
        creative: { id: "x", object_type: "SHARE" },
      },
    ];
    const a = audit(e, S);
    const failed = a.controls.filter((c) => c.state === "fail").map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "policy.disapproved",
        "structure.objective_goal",
        "delivery.learning",
        "creative.per_adset",
      ]),
    );
    expect(a.drafts.map((d) => d.control)).toEqual(expect.arrayContaining(failed));
    expect(a.health).toBeLessThan(100);
  });

  it("cold start turns off history rules and adds the staged plan", () => {
    const a = audit(
      warm({
        account: { id: "act_1", account_status: 1, amount_spent: "0" },
        recent: [],
        matured: [],
      }),
      S,
    );
    expect(a.coldStart.account).toBe("cold");
    const state = (id: string) => a.controls.find((c) => c.id === id)?.state;
    expect(state("structure.fragmentation")).toBe("not_applicable");
    expect(state("structure.objective_goal")).toBe("not_applicable");
    expect(a.drafts.filter((d) => d.control === null)).toHaveLength(3);
  });

  it("surfaces unknown critical controls and grades thin evidence insufficient", () => {
    const a = audit(warm({ account: null, pixels: null, adsets: null }), S);
    expect(a.gaps).toEqual(["policy.account_status", "measurement.pixel"]);
    expect(a.grade).toBe("insufficient");
  });

  it("checks the paused setup when nothing delivers", () => {
    const e = warm();
    e.adsets = [SET].map((s) => ({ ...s, effective_status: "PAUSED" }));
    e.ads = ADS.map((x) => ({ ...x, effective_status: "PAUSED" }));
    const a = audit(e, S);
    expect(a.scope).toBe("paused");
    expect(a.controls.find((c) => c.id === "creative.per_adset")?.state).toBe("pass");
    expect(a.controls.find((c) => c.id === "delivery.learning")?.state).toBe("not_applicable");
  });
});

describe("score", () => {
  it("weights by severity, renormalizes over present categories", () => {
    const s = score([
      { id: "a", category: "policy", severity: "critical", state: "pass", detail: "" },
      { id: "b", category: "policy", severity: "high", state: "fail", detail: "" },
      { id: "c", category: "delivery", severity: "medium", state: "unknown", detail: "" },
    ]);
    expect(s.categories.policy?.health).toBe(62.5); // 5 of 8
    expect(s.categories.delivery).toEqual({ health: null, coverage: 0 });
    expect(s.health).toBe(62.5);
    expect(s.coverage).toBeCloseTo(8 / 9);
  });
});

describe("gatherEvidence", () => {
  it("reads every part, a failed part stays null, the conversion window ends at the lag", async () => {
    const calls: { path: string; input: Record<string, unknown> }[] = [];
    const sites: SiteClient = {
      async call(_site, _method, path, input = {}) {
        calls.push({ path, input });
        if (path === "/act_9")
          return { id: "act_9", created_time: "2026-09-01T00:00:00Z" } as never;
        if (path.endsWith("/adspixels")) throw new Error("no permission");
        return { data: [] } as never;
      },
      async via() {
        return "api";
      },
    };
    const e = await gatherEvidence(metaAds(sites, { adAccountId: "act_9" }), new Date(NOW), S);
    expect(e.pixels).toBeNull();
    expect(e.errors.pixels).toBe("no permission");
    const range = calls.find((c) => c.input.time_range)?.input.time_range;
    expect(JSON.parse(String(range))).toEqual({ since: "2026-09-01", until: "2026-09-29" });
    expect(calls.find((c) => c.input.time_range)?.input).not.toHaveProperty("date_preset");
  });
});
