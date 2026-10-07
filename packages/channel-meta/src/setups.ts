/**
 * The Meta setup's check (designs/2026-10-07-setup-and-vendors.md): can Wren's token read the
 * client's ad account? One read of the account through autobrowse's `meta` site, free.
 */
import type { SiteClient } from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import type { SetupCheck } from "@wren/core/setup";
import { type AdAccount, accountIdOf } from "./ads.js";

/** Meta's `account_status` numbers, said to a person. 1 is active. */
const STATUS: Record<number, string> = {
  1: "active",
  2: "disabled",
  3: "unsettled",
  7: "in risk review",
  8: "pending settlement",
  9: "in a grace period",
  100: "pending closure",
  101: "closed",
};

export function metaChecks(sites: SiteClient): Record<string, SetupCheck> {
  return {
    "meta.ad_account": async ({ account }) => {
      const id = accountIdOf(account.ref.trim());
      if (!/^\d+$/.test(id))
        return { ok: false, why: "The ad account id should look like act_123" };
      try {
        const a = await sites.call<AdAccount>("meta", "GET", `/act_${id}`, {
          fields: "id,name,account_status",
        });
        const status = a.account_status === undefined ? null : STATUS[a.account_status];
        return {
          ok: true,
          why: status && status !== "active" ? `Wren reads it. It's ${status}` : "Wren reads it",
          seen: { id: a.id, name: a.name ?? null, status: a.account_status ?? null },
        };
      } catch (err) {
        return isRefusal(err)
          ? { ok: false, why: "Wren can't read this ad account yet" }
          : { ok: false, why: `Couldn't reach Meta: ${(err as Error).message.slice(0, 200)}` };
      }
    },
  };
}
