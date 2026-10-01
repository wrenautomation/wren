/** The account's calls, keyed so a write's reload asks again. */
import {
  type AccountView,
  call,
  type InvoiceView,
  type MailLevel,
  type MemberView,
} from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

const ask = <T>(route: string, p: PageProps) =>
  call<T>(`delivery/${route}`, { client: p.client, asClient: !p.team });

export const useAccount = (p: PageProps) =>
  useCall(`account:${p.client}:${p.team}`, () => ask<AccountView>("account", p));

export const usePeople = (p: PageProps, nonce: number) =>
  useCall(`people:${p.client}:${p.team}:${nonce}`, () =>
    ask<{ people: MemberView[]; canManage: boolean; mail: MailLevel | null }>("people", p),
  );

export const useInvoices = (p: PageProps) =>
  useCall(`invoices:${p.client}:${p.team}`, () => ask<{ invoices: InvoiceView[] }>("invoices", p));

/** Whole currency units unless there are cents: "$1,000", "$2,500.50", "EUR 900". */
export function money(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}
