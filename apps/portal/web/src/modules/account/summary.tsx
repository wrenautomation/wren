/**
 * Accounts and vendors from Wren's side: a client's in short on its Clients record, and this
 * month's managed usage across clients (designs/2026-10-07-setup-and-vendors.md).
 */
import type { AccountsView } from "@wren/core/accounts/console";
import { ButtonLink, Empty, LoadFailed, Loading, Tag } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { PageRows, rowLines } from "../../page-rows.js";
import { QUIET, TOOLS } from "../work/bits.js";
import { runTag } from "./setups.js";

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
        <PageRows<AccountsView["accounts"][number]>
          label="Accounts"
          noun="account"
          lines={rowLines(got.data.accounts, (a) => String(a.id))}
          name={{
            label: "Account",
            icon: "key",
            min: 220,
            title: (a) => a.siteLabel,
            weight: () => "font-medium text-(--ui-ink)",
            sub: (a) => <span className={`${QUIET} wrap-anywhere whitespace-normal`}>{a.ref}</span>,
          }}
          columns={[
            {
              key: "runs",
              label: "Setups",
              icon: "workflow",
              min: 160,
              phone: true,
              cell: (a) => (
                <span className="flex flex-wrap gap-1.5">
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
              ),
            },
          ]}
        />
      ) : (
        <Empty waits>No accounts yet. Each one you connect lists here.</Empty>
      )}
      <div className={TOOLS}>
        <ButtonLink href={`/office/accounts${q}`} size="dense" tone="secondary" arrow>
          Accounts
        </ButtonLink>
      </div>
    </div>
  );
}
