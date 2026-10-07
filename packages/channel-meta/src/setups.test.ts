import { SiteCallError, type SiteClient } from "@wren/core/content";
import type { AccountRow } from "@wren/core/setup-schema";
import { describe, expect, it } from "vitest";
import { metaChecks } from "./setups.js";

const adAccount = (ref: string) => ({ id: 1, client: "acme", site: "meta", ref }) as AccountRow;
const now = new Date(0);

function sites(answer: (path: string) => unknown) {
  const calls: { method: string; path: string; input: unknown }[] = [];
  const s: SiteClient = {
    async call(_site, method, path, input) {
      calls.push({ method, path, input });
      return answer(path) as never;
    },
    async via() {
      return "api";
    },
  };
  return { s, calls };
}

describe("meta.ad_account", () => {
  it("passes on one read of the ad account, with or without act_", async () => {
    const { s, calls } = sites(() => ({ id: "act_123", name: "Acme", account_status: 1 }));
    const check = metaChecks(s)["meta.ad_account"];
    for (const ref of ["act_123", "123"])
      expect(await check?.({ account: adAccount(ref), now })).toMatchObject({
        ok: true,
        why: "Wren reads it",
      });
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/act_123",
      input: { fields: "id,name,account_status" },
    });
  });

  it("says when the account it reads isn't active", async () => {
    const { s } = sites(() => ({ id: "act_123", account_status: 2 }));
    expect(
      await metaChecks(s)["meta.ad_account"]?.({ account: adAccount("act_123"), now }),
    ).toMatchObject({ ok: true, why: "Wren reads it. It's disabled" });
  });

  it("waits when Meta refuses, when it's down, and on a ref that isn't an id", async () => {
    const refused = sites(() => {
      throw new SiteCallError("meta", "GET", "/act_9", 403, "no permission");
    });
    expect(
      await metaChecks(refused.s)["meta.ad_account"]?.({ account: adAccount("act_9"), now }),
    ).toEqual({ ok: false, why: "Wren can't read this ad account yet" });
    const down = sites(() => {
      throw new Error("timed out");
    });
    expect(
      await metaChecks(down.s)["meta.ad_account"]?.({ account: adAccount("act_9"), now }),
    ).toEqual({ ok: false, why: "Couldn't reach Meta: timed out" });
    const { s, calls } = sites(() => ({}));
    expect(
      await metaChecks(s)["meta.ad_account"]?.({ account: adAccount("Acme ads"), now }),
    ).toEqual({ ok: false, why: "The ad account id should look like act_123" });
    expect(calls).toEqual([]);
  });
});
