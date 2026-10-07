/**
 * Accounts and vendors from Wren's side: a client's in short on its Clients record, and this
 * month's managed usage across clients (designs/2026-10-07-setup-and-vendors.md).
 */
import type { AccountsView, UsageView } from "@wren/core/accounts/console";
import { Alert, ButtonLink, Empty, Loading, PageHeader, Section, Tag } from "@wren/ui";
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
  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
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
        <ButtonLink href={`/account/accounts${q}`} size="sm" tone="quiet" arrow>
          Accounts
        </ButtonLink>
        <ButtonLink href={`/account/vendors${q}`} size="sm" tone="quiet" arrow>
          Vendors
        </ButtonLink>
      </div>
    </div>
  );
}

const MODE: Record<string, string> = { managed: "on Wren's key", own: "on their own key" };

/** This month's metered usage, per client and vendor, most spent first. */
export function VendorUsage() {
  const got = useCall("vendor-usage", () => call<UsageView>("accounts/usage", {}));
  const d = got.data;
  const byClient = new Map<string, UsageView["rows"]>();
  for (const r of d?.rows ?? []) {
    const k = r.client ?? "wren";
    byClient.set(k, [...(byClient.get(k) ?? []), r]);
  }
  const total = (d?.rows ?? []).reduce((n, r) => n + r.micros, 0);
  return (
    <>
      <PageHeader
        title="Vendor usage"
        lede={
          d
            ? `Since ${dayLabel(d.from)}: about ${dollars(total)} at public prices. Billing drafts it monthly.`
            : undefined
        }
      />
      {got.error && !d ? (
        <Alert onRetry={got.retry}>{got.error.message}</Alert>
      ) : !d ? (
        <Loading lines={4} />
      ) : byClient.size === 0 ? (
        <Empty>Nothing metered this month yet.</Empty>
      ) : (
        [...byClient].map(([id, rows]) => (
          <Section
            key={id}
            title={rows[0]?.clientName ?? id}
            note={`About ${dollars(rows.reduce((n, r) => n + r.micros, 0))} this month.`}
            actions={
              id === "wren" ? null : (
                <a
                  className="text-[14px] underline underline-offset-2"
                  href={`/account/vendors?client=${encodeURIComponent(id)}`}
                >
                  Vendors
                </a>
              )
            }
          >
            <ul className={LIST}>
              {rows.map((r) => (
                <li key={`${r.vendor}:${r.mode}`} className="grid gap-1">
                  <span className={SPLIT}>
                    <b className="font-medium">{r.vendorName}</b>
                    <span>{dollars(r.micros)}</span>
                  </span>
                  <span className={QUIET}>
                    {unitsText(r.units, r.unit)}
                    {id !== "wren" && MODE[r.mode] ? `, ${MODE[r.mode]}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
    </>
  );
}
