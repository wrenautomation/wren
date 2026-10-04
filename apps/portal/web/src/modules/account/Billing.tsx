/** Billing: the invoices we've sent through Wise, for the account's owners. */
import {
  Alert,
  ButtonLink,
  Empty,
  Loading,
  PageHeader,
  Section,
  Table,
  Tag,
  type TagTone,
} from "@wren/ui";
import type { InvoiceView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { BLOCK, dayLabel, QUIET } from "../work/bits.js";
import { money, useInvoices } from "./load.js";

const STATUS: Record<InvoiceView["status"], [string, TagTone]> = {
  open: ["Due", "neutral"],
  overdue: ["Overdue", "rust"],
  paid: ["Paid", "green"],
  void: ["Cancelled", "neutral"],
};

export function Billing(props: PageProps) {
  const bills = useInvoices(props);
  return (
    <>
      <PageHeader
        title="Billing"
        lede="We bill through Wise. Each invoice also comes by email, with a link to pay."
      />
      <Section>
        {bills.error?.status === 403 ? (
          <Empty>Billing is for the account's owners.</Empty>
        ) : bills.error && !bills.data ? (
          <Alert onRetry={bills.retry}>{bills.error.message}</Alert>
        ) : !bills.data ? (
          <Loading lines={3} />
        ) : bills.data.invoices.length === 0 ? (
          <Empty>No invoices yet.</Empty>
        ) : (
          <Table stale={bills.loading} stack>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>For</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
                <th aria-label="Open in Wise" />
              </tr>
            </thead>
            <tbody>
              {bills.data.invoices.map((i) => {
                const [label, tone] = STATUS[i.status];
                return (
                  <tr key={i.id}>
                    <td>
                      <b>{i.number}</b>
                      <span className={`${QUIET} ${BLOCK}`}>Sent {dayLabel(i.issuedOn)}</span>
                    </td>
                    <td data-label="For">
                      {i.description}
                      <span className={`${QUIET} ${BLOCK}`}>{i.offer}</span>
                    </td>
                    <td data-label="Amount">{money(i.cents, i.currency)}</td>
                    <td data-label="Due">{dayLabel(i.dueOn)}</td>
                    <td data-label="Status">
                      <Tag tone={tone}>{label}</Tag>
                      {i.paidOn ? (
                        <span className={`${QUIET} ${BLOCK}`}>{dayLabel(i.paidOn)}</span>
                      ) : null}
                    </td>
                    <td data-label="">
                      {i.link ? (
                        <ButtonLink
                          href={i.link}
                          target="_blank"
                          rel="noreferrer"
                          icon="external"
                          size="sm"
                          tone={i.status === "open" || i.status === "overdue" ? "primary" : "quiet"}
                        >
                          {i.status === "open" || i.status === "overdue" ? "Pay" : "View"}
                        </ButtonLink>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
