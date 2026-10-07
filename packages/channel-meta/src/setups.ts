/**
 * The Meta setup's checks (designs/2026-10-07-setup-and-vendors.md): can Wren's token read the
 * client's ad account, and is a Page there that Wren may run ads for? Each is one free read of
 * the account through autobrowse's `meta` site; the Pages come by field expansion.
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

const NOT_AN_ID = { ok: false, why: "The ad account id should look like act_123" };
const failed = (err: unknown) =>
  isRefusal(err)
    ? { ok: false, why: "Wren can't read this ad account yet" }
    : { ok: false, why: `Couldn't reach Meta: ${(err as Error).message.slice(0, 200)}` };

interface Promotable {
  id: string;
  promote_pages?: { data?: { id: string; name?: string }[] };
}

export function metaChecks(sites: SiteClient): Record<string, SetupCheck> {
  return {
    "meta.page": async ({ account }) => {
      const id = accountIdOf(account.ref.trim());
      if (!/^\d+$/.test(id)) return NOT_AN_ID;
      let a: Promotable;
      try {
        a = await sites.call<Promotable>("meta", "GET", `/act_${id}`, {
          fields: "id,promote_pages.limit(10){id,name}",
        });
      } catch (err) {
        return failed(err);
      }
      const pages = (a.promote_pages?.data ?? []).map((p) => ({ id: p.id, name: p.name ?? null }));
      const [one] = pages;
      if (!one) return { ok: false, why: "No Page on this ad account Wren can run ads for yet" };
      return {
        ok: true,
        why:
          pages.length === 1
            ? `Wren can run ads for ${one.name ?? "its Page"}`
            : `Wren can run ads for ${pages.length} Pages`,
        seen: pages,
      };
    },
    "meta.ad_account": async ({ account }) => {
      const id = accountIdOf(account.ref.trim());
      if (!/^\d+$/.test(id)) return NOT_AN_ID;
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
        return failed(err);
      }
    },
  };
}
