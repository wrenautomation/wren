/**
 * Now: the setup items waiting on whoever looks (designs/2026-10-07-setup-and-vendors.md, "Setup
 * alerts"). Wren's team on Wren's home sees every client's to-do; a client's people see theirs on
 * their home, and Accounts carries the count. Nothing shows when nothing waits.
 */
import type { NowView } from "@wren/core/accounts/console";
import { Section, Tag, type TagTone } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { dayLabel, LIST, QUIET, SPLIT } from "../work/bits.js";
import { ownerOf } from "./Accounts.js";

type Item = NowView["items"][number];

/** An item's tag, said to whoever looks. */
export function nowTag(
  x: Pick<Item, "kind" | "for">,
  team: boolean,
): { label: string; tone: TagTone } {
  switch (x.kind) {
    case "lost":
      return { label: "Lost", tone: "warn" };
    case "stuck":
      return { label: "Stuck", tone: "warn" };
    case "waiting":
      return team && x.for === "client"
        ? { label: "Waiting on the client", tone: "neutral" }
        : { label: "Your turn", tone: "accent" };
    case "paused":
      return { label: "Paused", tone: "accent" };
    case "done":
      return { label: "Set up", tone: "green" };
    default:
      return { label: "Back on", tone: "green" };
  }
}

/** The badge's read: the open items here. */
export const nowCount = (client: string, team: boolean) =>
  call<NowView>("accounts/now", { client: ownerOf(client), asClient: !team }).then((d) => d.count);

/** Accounts for this owner: a client's page, or none for Wren's own (no page of its own yet). */
const hrefOf = (x: Item) =>
  x.client ? `/account/accounts?client=${encodeURIComponent(x.client)}` : null;

export function SetupNow({ client, team }: { client: string; team: boolean }) {
  const got = useCall(`now:${client}:${team}`, () =>
    call<NowView>("accounts/now", { client: ownerOf(client), asClient: !team }),
  );
  const d = got.data;
  // A failed read or nothing to do: no section. Accounts still shows it all.
  if (!d?.items.length) return null;
  const across = d.owner.id === null;
  return (
    <Section
      title="Now"
      note={across ? "Setups across clients that need the team." : "Setups that need a look."}
    >
      <ul className={LIST} aria-label="Now">
        {d.items.map((x) => {
          const tag = nowTag(x, d.team);
          const href = hrefOf(x);
          return (
            <li key={x.id} className="grid gap-1">
              <span className={SPLIT}>
                {href ? (
                  <a href={href} className="min-w-0 font-medium">
                    {x.title}
                  </a>
                ) : (
                  <span className="min-w-0 font-medium">{x.title}</span>
                )}
                <Tag tone={tag.tone}>{tag.label}</Tag>
              </span>
              <span className={QUIET}>
                {[across ? x.clientName : null, x.why, dayLabel(x.at)].filter(Boolean).join(" · ")}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
