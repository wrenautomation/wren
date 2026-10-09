/**
 * Accounts and vendors from Wren's side: a client's in short on its Clients record, and this
 * month's managed usage across clients (designs/2026-10-07-setup-and-vendors.md).
 */
import type { AccountsView, UsageView } from "@wren/core/accounts/console";
import { ButtonLink, Empty, LoadFailed, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { dayLabel, LIST, QUIET, SPLIT, TOOLS } from "../work/bits.js";
import { dollars, runTag, unitsText } from "./setups.js";

/** A client's accounts, a line each with where its setups stand, and links to both pages. */
export function ClientAccounts({ client }: { client: string }) {
  const got = useCall(`client-accounts:${client}`, () =>
    call<AccountsView>("accounts/accounts", { client, asClient: false }),
  );
  const q = `?client=${encodeURIComponent(client)}`;
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={2} />;
  return (
    <div className="grid gap-3">
      {got.data.accounts.length ? (
        <ul className={LIST}>
          {got.data.accounts.map((a) => (
            <li key={a.id} className="grid gap-1">
              <span className={SPLIT}>
                <b className="font-medium">{a.siteLabel}</b>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {a.runs.map((r) => {
                    const t = runTag(r.state, true);
                    return (
                      <Tag key={r.setup} tone={t.tone} title={r.name}>
                        {t.label}
                      </Tag>
                    );
                  })}
                  {!a.runs.length && a.setups.length ? <Tag>Not started</Tag> : null}
                </span>
              </span>
              <span className={`${QUIET} break-all`}>{a.ref}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No accounts yet.</Empty>
      )}
      <div className={TOOLS}>
        <ButtonLink href={`/account/accounts${q}`} size="dense" tone="secondary" arrow>
          Accounts
        </ButtonLink>
        <ButtonLink href={`/account/vendors${q}`} size="dense" tone="secondary" arrow>
          Vendors
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * This month's metered use, per owner and vendor. Totals count Wren's key only: what Wren pays
 * and may bill. A client's own-key use is its own line, priced, billed to it by the vendor.
 */
export function VendorUsage() {
  const got = useCall("vendor-usage", () => call<UsageView>("accounts/usage", {}));
  const d = got.data;
  const byOwner = new Map<string, UsageView["rows"]>();
  for (const r of d?.rows ?? []) {
    const k = r.client ?? "wren";
    byOwner.set(k, [...(byOwner.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader
        title="Vendor usage"
        lede={
          d
            ? `Since ${dayLabel(d.from)}: about ${dollars(d.total)} on Wren's key at public prices. Billing drafts it monthly.`
            : undefined
        }
      />
      {got.error && !d ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !d ? (
        <Loading lines={4} />
      ) : byOwner.size === 0 ? (
        <Empty>Nothing metered this month yet.</Empty>
      ) : (
        d.owners.map((o) => {
          const id = o.client ?? "wren";
          const rows = byOwner.get(id) ?? [];
          // Wren's key first: what Wren pays. Their own key after it.
          const ordered = [
            ...rows.filter((r) => r.mode === "managed"),
            ...rows.filter((r) => r.mode !== "managed"),
          ];
          return (
            <Section
              key={id}
              title={o.name}
              note={
                o.micros || o.client === null
                  ? `About ${dollars(o.micros)} on Wren's key this month.`
                  : "Nothing on Wren's key this month."
              }
              actions={
                o.client === null ? null : (
                  <a
                    className="text-[14px] underline underline-offset-2"
                    href={`/account/vendors?client=${encodeURIComponent(o.client)}`}
                  >
                    Vendors
                  </a>
                )
              }
            >
              <ul className={LIST}>
                {ordered.map((r) => {
                  const own = r.mode === "own";
                  return (
                    <li key={`${r.vendor}:${r.mode}`} className="grid gap-1">
                      <span className={SPLIT}>
                        <b className="font-medium">{r.vendorName}</b>
                        <span className={own ? QUIET : undefined}>{dollars(r.micros)}</span>
                      </span>
                      <span className={QUIET}>
                        {unitsText(r.units, r.unit)}
                        {own
                          ? `, on their own key. ${r.vendorName} bills them.`
                          : o.client === null
                            ? ""
                            : ", on Wren's key"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })
      )}
    </>
  );
}
