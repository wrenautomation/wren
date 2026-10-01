/** The account at a glance: who the company is to us, what they bought, who's on it, what's owed. */
import {
  Alert,
  ButtonLink,
  Empty,
  Facts,
  Loading,
  month,
  PageHeader,
  Section,
  Tag,
} from "@wren/ui";
import type { AccountView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { dayLabel } from "../work/bits.js";
import { at } from "../work/nav.js";
import { useAccount } from "./load.js";

const STATUS: Record<AccountView["bought"][number]["status"], string> = {
  active: "Running",
  paused: "Paused",
  done: "Finished",
};

const roleOf = (you: AccountView["you"]) =>
  you.role === "owner" ? "Owner" : you.role === "member" ? "Member" : you.wren ? "Wren's team" : "";

export function Overview(props: PageProps) {
  const acct = useAccount(props);
  if (acct.error && !acct.data)
    return (
      <>
        <PageHeader title="Account" />
        <Alert onRetry={acct.retry}>{acct.error.message}</Alert>
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
  return (
    <>
      <PageHeader title={a.name} lede={`Working with Wren since ${month(a.since)}.`} />
      <Section
        title="What you have with us"
        actions={
          a.bought.length ? (
            <ButtonLink href={at("home")} size="sm" tone="quiet" arrow>
              Your project
            </ButtonLink>
          ) : null
        }
      >
        {a.bought.length === 0 ? (
          <Empty>Nothing started yet.</Empty>
        ) : (
          <ul className="wk-list">
            {a.bought.map((b) => (
              <li key={b.id} className="wk-person">
                <span>
                  <b>{b.offer}</b>
                  <span className="wk-quiet wk-block">Started {dayLabel(b.startsOn)}</span>
                </span>
                <Tag tone={b.status === "active" ? "green" : "neutral"}>{STATUS[b.status]}</Tag>
              </li>
            ))}
          </ul>
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
            ["Owners", a.owners.length ? a.owners.join(", ") : "None yet"],
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
              <Tag tone="rust">
                {a.billing.overdue} {a.billing.overdue === 1 ? "invoice is" : "invoices are"}{" "}
                overdue
              </Tag>
            </p>
          ) : null}
          <p className="wk-quiet">
            {a.billing.open > 0
              ? `${a.billing.open} ${a.billing.open === 1 ? "invoice" : "invoices"} due.`
              : "Nothing due right now."}
          </p>
        </Section>
      ) : null}
    </>
  );
}
