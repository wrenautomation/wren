import { setupWorkflow } from "@wren/core/setup";
import type { AccountRow } from "@wren/core/setup-schema";
import { checkWorkflows } from "@wren/core/workflows";
import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import { FakeRegistration } from "./provider.js";
import { SMS_SETUPS, smsChecks } from "./setups.js";

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
