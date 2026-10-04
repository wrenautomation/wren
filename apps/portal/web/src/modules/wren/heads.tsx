/** What Wren's lists add beside their title (this month's AI spend), and a client's short name. */
import type { RecordsStat } from "@wren/core/records/serve";
import { money } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";

/** The short name a client's name suggests: "Acme & Co." is "acme_co". */
export const idOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
    .replace(/_+$/, "");

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const AI_SPEND = "account=~AI+models";

/** Model calls cost money: this month's AI spend beside them, a link to its lines. */
export function AiSpend() {
  const stat = useCall("ai-spend", () =>
    call<RecordsStat>("console/recordsStats", {
      record: "books.spend",
      view: "all",
      where: { account: { contains: "AI models" } },
      period: "month",
      sum: "amount",
      zone: ZONE,
    }),
  );
  const s = stat.data;
  if (!s?.currency) return null;
  const amount = money(s.value ?? 0, s.currency);
  return (
    <a
      href={`/money/spend?view=this_month&${AI_SPEND}`}
      className="mr-2 text-[13px] whitespace-nowrap text-(--ui-ink-2) hover:text-(--ui-ink)"
    >
      AI spend this month: <span className="font-medium text-(--ui-ink)">{amount}</span>
    </a>
  );
}
