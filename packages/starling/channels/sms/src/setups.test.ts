import { SiteCallError, type SiteClient } from "@wren/core/content";
import { setupWorkflow } from "@wren/core/setup";
import type { AccountRow } from "@wren/core/setup-schema";
import { checkWorkflows } from "@wren/core/workflows";
import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import { FakeRegistration } from "./provider.js";
import { findPlace, type PlaceFound, SMS_SETUPS, smsChecks } from "./setups.js";

const wrens = (ref: string) => ({ id: 1, client: null, site: "number", ref }) as AccountRow;
const now = new Date(0);

describe("the texting setups", () => {
  it("are valid setup workflows", () => {
    expect(checkWorkflows(SMS_SETUPS.map(setupWorkflow), [])).toEqual([]);
  });

  it("check Wren's campaign with the carriers, then each number on it", async () => {
    const reg = new FakeRegistration();
    const c = smsChecks({} as Db, reg, "camp-1");
    expect(await c["telnyx.campaign"]?.({ account: wrens("profile"), now })).toMatchObject({
      ok: false,
      why: "Carriers say MNO_PENDING",
    });
    reg.campaignState = { status: "approved", raw: "ACTIVE", detail: null };
    expect(await c["telnyx.campaign"]?.({ account: wrens("profile"), now })).toMatchObject({
      ok: true,
    });

    expect(await c["telnyx.number"]?.({ account: wrens("+15550100001"), now })).toMatchObject({
      ok: false,
      why: "Not attached yet",
    });
    await reg.assign("+15550100001", "camp-1");
    reg.settle();
    expect(await c["telnyx.number"]?.({ account: wrens("+15550100001"), now })).toMatchObject({
      ok: true,
    });
    await reg.assign("+15550100002", "camp-other");
    reg.settle();
    expect(await c["telnyx.number"]?.({ account: wrens("+15550100002"), now })).toMatchObject({
      ok: false,
      why: "On another campaign",
    });
  });

  it("says so when there's no campaign yet", async () => {
    const c = smsChecks({} as Db, new FakeRegistration(), null);
    expect(await c["telnyx.campaign"]?.({ account: wrens("profile"), now })).toEqual({
      ok: false,
      why: "No campaign id set yet",
    });
  });
});

describe("findPlace", () => {
  const PLACE = "ChIJsynthetic_place-0001";
  const asked: unknown[] = [];
  const sites = (answer: PlaceFound | Error): SiteClient => ({
    call: async <T>(...args: unknown[]) => {
      asked.push(args);
      if (answer instanceof Error) throw answer;
      return answer as T;
    },
    via: async () => "browser",
  });
  const found: PlaceFound = {
    placeId: PLACE,
    name: "Northwind Plumbing",
    address: "12 Elm St, Springfield",
    via: "place",
  };

  it("asks Maps on the desk for the name and address, and keeps the Place ID", async () => {
    const got = await findPlace(sites(found), "Northwind Plumbing, 12 Elm St");
    expect(got).toEqual({
      ref: PLACE,
      why: "Found on Google Maps: Northwind Plumbing, 12 Elm St, Springfield",
    });
    expect(asked.at(-1)).toEqual(["web", "GET", "/place", { q: "Northwind Plumbing, 12 Elm St" }]);
  });

  it("a Place ID stands; no match or a failed read says why", async () => {
    asked.length = 0;
    expect(await findPlace(sites(found), PLACE)).toEqual({ ref: PLACE, why: "Already a Place ID" });
    expect(asked).toHaveLength(0);
    const none = { ...found, placeId: null, via: "none" as const };
    expect((await findPlace(sites(none), "Contoso, 1 Main St")).ref).toBeNull();
    const off = new SiteCallError("web", "GET", "/place", 503, "desk is off");
    expect(await findPlace(sites(off), "Contoso, 1 Main St")).toMatchObject({
      ref: null,
      why: expect.stringContaining("desk is off"),
    });
    await expect(findPlace(sites(new Error("boom")), "Contoso")).rejects.toThrow("boom");
  });
});
