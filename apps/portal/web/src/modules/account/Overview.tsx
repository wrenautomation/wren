/** The account at a glance: who the company is to us, what they bought, who's on it, what's owed. */
import {
  ButtonLink,
  Empty,
  Facts,
  LoadFailed,
  Loading,
  month,
  PageHeader,
  Pill,
  Section,
  Tag,
} from "@wren/ui";
import type { AccountView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { PageRows, rowLines } from "../../page-rows.js";
import { dayLabel, QUIET } from "../work/bits.js";
import { useAccount } from "./load.js";

const STATUS: Record<AccountView["bought"][number]["status"], string> = {
  onboarding: "Getting started",
  active: "Running",
  paused: "Paused",
  done: "Finished",
};

type Bought = AccountView["bought"][number];

const roleOf = (you: AccountView["you"]) =>
  you.role === "owner" ? "Owner" : you.role === "member" ? "Member" : you.wren ? "Wren's team" : "";

export function Overview(props: PageProps) {
  const acct = useAccount(props);
  if (acct.error && !acct.data)
    return (
      <>
        <PageHeader title="Account" />
        <LoadFailed error={acct.error} onRetry={acct.retry} />
      </>
    );
  if (!acct.data)
    return (
      <>
        <PageHeader title="Account" />
        <Loading lines={6} />
      </>
    );
  const a = acct.data;
  const more = a.people - a.owners.length;
  const lines = rowLines(a.bought, (b) => String(b.id));
  return (
    <>
      <PageHeader title={a.name} lede={`Working with Wren since ${month(a.since)}.`} />
      <Section title="What you have with us">
        {a.bought.length === 0 ? (
          <Empty>Nothing started yet.</Empty>
        ) : (
          <PageRows<Bought>
            label="What you have with us"
            noun="offer"
            lines={lines}
            name={{
              label: "Offer",
              icon: "briefcase",
              min: 200,
              title: (b) => b.offer,
              href: (b) => `/${b.app}/overview`,
            }}
            columns={[
              {
                key: "since",
                label: "Since",
                icon: "calendar",
                width: 160,
                quiet: true,
                cell: (b) =>
                  `${b.status === "onboarding" ? "Starts" : "Started"} ${dayLabel(b.startsOn)}`,
              },
              {
                key: "status",
                label: "Status",
                icon: "pulse",
                width: 150,
                phone: true,
                cell: (b) => (
                  <Pill color={b.status === "active" ? "var(--ui-good)" : "var(--ui-ink-3)"}>
                    {STATUS[b.status]}
                  </Pill>
                ),
              },
            ]}
          />
        )}
      </Section>
      <Section
        title="People"
        actions={
          <ButtonLink href="/account/people" size="sm" tone="quiet" arrow>
            Manage
          </ButtonLink>
        }
      >
        <Facts
          items={[
            ["Owners", a.owners.length ? a.owners.join(", ") : "No owner set"],
            ["Others", more > 0 ? String(more) : "None"],
            ["You", [a.you.email, roleOf(a.you)].filter(Boolean).join(" · ")],
          ]}
        />
      </Section>
      {a.billing ? (
        <Section
          title="Billing"
          actions={
            <ButtonLink href="/account/billing" size="sm" tone="quiet" arrow>
              Invoices
            </ButtonLink>
          }
        >
          {a.billing.overdue > 0 ? (
            <p>
              <Tag tone="accent">
                {a.billing.overdue} {a.billing.overdue === 1 ? "invoice is" : "invoices are"}{" "}
                overdue
              </Tag>
            </p>
          ) : null}
          <p className={QUIET}>
            {a.billing.open > 0
              ? `${a.billing.open} ${a.billing.open === 1 ? "invoice" : "invoices"} due.`
              : "Nothing due right now."}
          </p>
        </Section>
      ) : null}
    </>
  );
}
