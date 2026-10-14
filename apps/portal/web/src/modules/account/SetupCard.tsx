/**
 * Get set up: Today's card over the owner's setups (designs/2026-10-14-customerio-audit.md, B3).
 * How many are done, a bar with a segment each, and the next step with its button. It goes once
 * every setup is done, and never shows when there are none.
 */
import type { AccountsView } from "@wren/core/accounts/console";
import { ButtonLink, cx, FRAME, FRAME_HEAD, num, SECTION_TITLE } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { ownerOf } from "./Accounts.js";
import { setupProgress } from "./setups.js";

/** The card itself: nothing while it loads, fails, or once all is set up. */
export function SetupCard({
  client,
  team,
  href,
}: {
  client: string;
  team: boolean;
  /** The setups' page, where there is one in this workspace. */
  href: string | null;
}) {
  const got = useCall(`setup:${client}:${team}`, () =>
    call<AccountsView>("accounts/accounts", { client: ownerOf(client), asClient: !team }),
  );
  const p = got.data ? setupProgress(got.data, team) : null;
  if (!p) return null;
  return (
    <section className={cx(FRAME, "mb-8")} aria-label="Get set up">
      <div className={FRAME_HEAD}>
        <h2 className={SECTION_TITLE}>
          Get set up
          <span className="font-normal text-(--ui-ink-2)">
            {" "}
            · {num(p.done)} of {num(p.total)} done
          </span>
        </h2>
      </div>
      <div className="grid gap-4 p-4">
        <div className="flex gap-1" aria-hidden="true">
          {p.bar.map((on, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity of their own.
              key={i}
              className={cx("h-1.5 flex-1", on ? "bg-(--ui-good-ink)" : "bg-(--ui-fill)")}
            />
          ))}
        </div>
        {p.next ? (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="grid min-w-0 gap-0.5">
              <span className="text-[12.5px] text-(--ui-ink-2)">Next · {p.next.name}</span>
              <span className="text-[15px] font-medium text-pretty">{p.next.step}</span>
              <span className="text-[13px] text-pretty text-(--ui-ink-2)">
                {[p.next.who, p.next.why].filter(Boolean).join(" · ")}
              </span>
            </div>
            {href ? (
              <ButtonLink size="dense" href={href}>
                Open setup
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
