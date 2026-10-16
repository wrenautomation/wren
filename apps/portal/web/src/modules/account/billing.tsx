/**
 * Account → Billing: an invoice's detail says how to pay it by bank transfer, each value with
 * its copy button, and offers its PDF (designs/2026-10-15-wise-billing.md). The details come from
 * the server per request; nothing here holds a bank number.
 */
import { Copyable, type RecordExtras } from "@wren/ui";
import type { ReactNode } from "react";
import type { ListPage } from "../../module.js";
import { PdfButton } from "../../pdf-button.js";
import { QUIET } from "../work/bits.js";

interface Pay {
  open: boolean;
  reference: string;
  currency: string;
  due: string;
  fields: [string, string][];
}

function HowToPay({ pay }: { pay: Pay }) {
  const lines: [string, string][] = [
    ["Reference", pay.reference],
    ["Amount", pay.due],
    ...pay.fields,
  ];
  return (
    <div className="grid gap-2 text-[14px]">
      <p>Pay by bank transfer. Put the reference in the memo so we can match your payment.</p>
      <dl className="grid gap-1.5">
        {lines.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[12rem_1fr] sm:items-center">
            <dt className={QUIET}>{label}</dt>
            <dd>
              <Copyable text={value} />
            </dd>
          </div>
        ))}
      </dl>
      {pay.fields.length === 0 ? (
        <p className={QUIET}>
          Reply to the invoice email and we'll send our bank details for {pay.currency}.
        </p>
      ) : null}
    </div>
  );
}

export const invoiceExtras: NonNullable<ListPage["extras"]> = (detail, { row, client }) => {
  const pay = (detail as { pay?: Pay | null } | null)?.pay ?? null;
  const sections: [string, ReactNode][] = [];
  if (pay?.open) sections.push(["How to pay", <HowToPay key="pay" pay={pay} />]);
  sections.push([
    "Invoice",
    <PdfButton key="pdf" handler="delivery/invoicePdf" body={{ client, id: row.id }} />,
  ]);
  const out: RecordExtras = { sections };
  return out;
};
