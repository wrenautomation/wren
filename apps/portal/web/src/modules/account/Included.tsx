/**
 * Billing's one quiet line: the live tools the client has installed that we built in place of a
 * SaaS, and what they'd cost a month bought separately (`@wren/core/in-house`). Links to them.
 */
import { includedIn } from "@wren/core/in-house";
import { call, type Me } from "../../api.js";
import { useCall } from "../../load.js";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function Included({ client }: { client: string }) {
  const me = useCall(`included:${client}`, () => call<Me>("delivery/me"));
  const here = me.data?.clients.find((c) => c.id === client);
  const { tools, monthly } = includedIn(new Set(here?.installed ?? []));
  if (!tools.length) return null;
  const n = tools.length === 1 ? "1 tool" : `${tools.length} tools`;
  return (
    <p className="text-[13px] text-(--ui-ink-2)">
      {monthly > 0
        ? `Your plan includes ${n} that ${tools.length === 1 ? "costs" : "cost"} about ${usd(monthly)} a month bought separately. `
        : `Your plan includes ${n} you'd otherwise buy separately. `}
      <a href={`/marketplace/catalog?view=installed&client=${encodeURIComponent(client)}`}>
        See them
      </a>
    </p>
  );
}
