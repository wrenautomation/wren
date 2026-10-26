/**
 * Money's overview: where this month's spend goes, and whether spend grows. Each part answers
 * one question; a figure with no question behind it stays on its list, not on this page.
 */
import type { Row } from "@wren/core/records/serve";
import {
  ColumnsChart,
  cx,
  FLAT_HEAD,
  LoadFailed,
  Loading,
  money,
  PageTitle,
  SECTION_TITLE,
  SplitGhost,
  SplitPanel,
  type SplitRow,
  sliceColor,
  TopRecords,
  useLoad,
  useNarrow,
  useTypes,
} from "@wren/ui";
import type { PageProps } from "../../module.js";
import { wrenRecords } from "../../records.js";

const api = wrenRecords("money");
const SPEND = "/money/spend?view=this_month";
/** Bills land once a month, so a year of months shows a trend that days can't. */
const MONTHS = 12;

const amountOf = (c: unknown) =>
  c && typeof c === "object" && "amount" in c && typeof c.amount === "number"
    ? { amount: c.amount, currency: "currency" in c ? String(c.currency) : "CAD" }
    : null;
const wordOf = (c: unknown) =>
  typeof c === "string" ? c : c && typeof c === "object" && "name" in c ? String(c.name) : "";

interface Account {
  name: string;
  sum: number;
  vendors: string[];
}

/** This month's spend lines, every page of them, summed by account, biggest first. */
async function readMonth() {
  const rows: Row[] = [];
  let cursor: string | undefined;
  let currency = "CAD";
  for (let i = 0; i < 10; i++) {
    const page = await api.list({
      record: "books.spend",
      view: "this_month",
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...page.rows);
    if (!page.next) break;
    cursor = page.next;
  }
  const by = new Map<string, Account>();
  for (const r of rows) {
    const a = amountOf(r.amount);
    if (!a) continue;
    currency = a.currency;
    const name = wordOf(r.account) || "No account";
    const acc = by.get(name) ?? { name, sum: 0, vendors: [] };
    acc.sum += a.amount;
    const vendor = wordOf(r.vendor);
    if (vendor && !acc.vendors.includes(vendor)) acc.vendors.push(vendor);
    by.set(name, acc);
  }
  const accounts = [...by.values()].sort((a, b) => b.sum - a.sum);
  return { accounts, total: accounts.reduce((n, a) => n + a.sum, 0), currency };
}

/** The last year of months, oldest first: what each month spent. */
async function readMonths() {
  const page = await api.list({
    record: "books.month",
    view: "all",
    sort: "-month",
    limit: MONTHS,
  });
  return page.rows
    .flatMap((r) => {
      const at = typeof r.month === "string" ? new Date(r.month) : null;
      const a = amountOf(r.spend);
      return at && a ? [{ at, ...a }] : [];
    })
    .reverse();
}

const monthName = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** This month is still open: its column says so, so a short month never reads as a drop. */
const labelOf = (d: Date) => {
  const now = new Date();
  const open = d.getUTCFullYear() === now.getFullYear() && d.getUTCMonth() === now.getMonth();
  return open ? `${monthName(d)} so far` : monthName(d);
};

export function MoneyOverview(_: PageProps) {
  const narrow = useNarrow();
  const types = useTypes(api);
  const subs = types.data?.find((t) => t.id === "books.subscription");
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-8">
      <PageTitle title="Money" />
      <div
        className={cx(
          "grid items-start gap-x-12 gap-y-8",
          narrow ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
        )}
      >
        <MonthSplit />
        <div className="grid gap-8">
          <ByMonth />
          {subs ? (
            <TopRecords
              top={{
                label: "Renewing soon",
                record: "books.subscription",
                href: "/money/subscriptions?view=soon",
                fields: ["renewsOn", "cost"],
                empty: "Nothing renews soon.",
              }}
              meta={subs}
              api={api}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Where this month's money goes: a ring reads part of a whole, and the ranked rows say which
 * account takes most. Each row opens that account's lines.
 */
function MonthSplit() {
  const load = useLoad("money:month", readMonth, api);
  const label = "Spend this month";
  if (load.error && !load.data) return <LoadFailed error={load.error} onRetry={load.retry} />;
  if (!load.data) return <SplitGhost label={label} lines={5} shape="ring" />;
  const { accounts, total, currency } = load.data;
  const ai = accounts.find((a) => /AI models/i.test(a.name));
  const rows = accounts.map(
    (a, i): SplitRow => ({
      key: a.name,
      label: a.name,
      note: a.vendors.join(", "),
      weight: a.sum,
      value: money(a.sum, currency),
      color: sliceColor(i),
      href: `${SPEND}&${new URLSearchParams({ account: `~${a.name}` })}`,
    }),
  );
  return (
    <SplitPanel
      label={label}
      total={money(total, currency)}
      line={
        total === 0
          ? "Nothing spent this month yet"
          : `spent this month${ai ? ` · ${Math.round((ai.sum / total) * 100)}% on AI models` : ""}`
      }
      rows={rows}
      shape="ring"
    />
  );
}

/** Spend per month: whether it grows. One column a month, its figure on top. */
function ByMonth() {
  const load = useLoad("money:months", readMonths, api);
  const months = load.data ?? [];
  const currency = months[0]?.currency ?? "CAD";
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] content-start">
      <div className={FLAT_HEAD}>
        <h2 className={SECTION_TITLE}>Spend by month</h2>
        <a
          href="/numbers/months?view=all"
          className="text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)"
        >
          All months
        </a>
      </div>
      <div className="pt-3">
        {load.error && !load.data ? (
          <LoadFailed error={load.error} onRetry={load.retry} />
        ) : !load.data ? (
          <Loading shape="rows" lines={3} label="Loading spend by month" />
        ) : !months.length ? (
          <p className="m-0 text-[13px] text-(--ui-ink-2)">No months closed yet.</p>
        ) : (
          <ColumnsChart
            label="Spend"
            rows={months.map((m) => ({ label: labelOf(m.at), value: m.amount }))}
            format={(n) => money(n, currency).replace(/\.\d\d$/, "")}
          />
        )}
      </div>
    </section>
  );
}
