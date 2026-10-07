/**
 * The portal's bell, in the top bar of every workspace with Learn: what rang for you lately, new
 * ones counted on it. Opening it marks them seen. What the hour's limit held back waits in Today.
 */
import { cx, FRAME_HEAD, GROUP_LABEL, relative } from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import { Bell } from "@wren/ui/lib/lucide";
import { useCallback, useEffect, useState } from "react";
import { WREN } from "../../module.js";
import { type Bell as BellData, type BellLine, bell } from "./api.js";
import { ScoreBadge } from "./kinds.js";

/** How often the bell asks again while the tab is open. */
const EVERY_MS = 120_000;

const WHY: Record<BellLine["why"], string> = {
  new: "New post",
  score: "Scored high",
  saved: "Your saved link",
};

export function LearnBell({ client }: { client: string }) {
  const [data, setData] = useState<BellData | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () =>
      bell.read(client).then(
        (b) => setData(b),
        () => undefined,
      ),
    [client],
  );
  useEffect(() => {
    setData(null);
    void load();
    const again = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(again, EVERY_MS);
    addEventListener("focus", again);
    return () => {
      clearInterval(timer);
      removeEventListener("focus", again);
    };
  }, [load]);
  const onOpen = (next: boolean) => {
    setOpen(next);
    // Closed: the dots of what was seen clear.
    if (!next)
      return setData((d) =>
        d && !d.unseen ? { ...d, alerts: d.alerts.map((a) => ({ ...a, seen: true })) } : d,
      );
    if (!data?.unseen) return;
    // Seen once opened: the count clears now, the dots when it closes.
    void bell.seen(client).then(
      () => setData((d) => (d ? { ...d, unseen: 0 } : d)),
      () => undefined,
    );
  };
  const unseen = data?.unseen ?? 0;
  const q = client === WREN.id ? "" : `?client=${encodeURIComponent(client)}`;
  return (
    <Popover open={open} onOpenChange={onOpen}>
      <PopoverTrigger
        aria-label={unseen ? `Alerts, ${unseen} new` : "Alerts"}
        className="relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
      >
        <Bell size={17} aria-hidden="true" />
        {unseen ? (
          <span className="-top-0.5 -right-0.5 absolute inline-flex h-4 min-w-4 items-center justify-center bg-(--ui-accent) px-1 font-semibold text-(--ui-on-accent) text-[10.5px] tabular-nums leading-none">
            {unseen > 99 ? "99+" : unseen}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(380px,calc(100vw-24px))] gap-0 rounded-none bg-(--ui-paper) p-0 text-(--ui-ink) shadow-lg ring-(--ui-hair)"
      >
        <div className={FRAME_HEAD}>
          <span className={GROUP_LABEL}>Alerts</span>
          <a href={`/learn/today${q}`} className="text-[13px]" onClick={() => setOpen(false)}>
            Today
          </a>
        </div>
        {!data ? (
          <p className="m-0 px-4 py-6 text-[13.5px] text-(--ui-ink-2)">Loading</p>
        ) : !data.alerts.length ? (
          <p className="m-0 px-4 py-6 text-[13.5px] text-(--ui-ink-2)">
            Nothing has rung. New posts from your sources ring here, by what you pick on Sources.
          </p>
        ) : (
          <ul className="m-0 max-h-[min(440px,70dvh)] list-none overflow-y-auto overscroll-contain p-0">
            {data.alerts.map((a) => (
              <li key={a.id} className="border-(--ui-hair) border-b last:border-b-0">
                <a
                  href={`/learn/items/${a.itemId}${q}`}
                  onClick={() => setOpen(false)}
                  className="flex gap-3 px-4 py-3 text-(--ui-ink) no-underline hover:bg-(--ui-hover)"
                >
                  <span className="mt-0.5 flex w-5 shrink-0 justify-center">
                    {a.score !== null ? (
                      <ScoreBadge score={a.score} />
                    ) : (
                      <span className="mt-1.5 size-2 bg-(--ui-ink-2)" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        "line-clamp-2 text-[13.5px] leading-5",
                        a.seen ? "font-normal" : "font-semibold",
                      )}
                    >
                      {a.title}
                    </span>
                    {a.line ? (
                      <span className="mt-0.5 line-clamp-1 text-[12.5px] text-(--ui-ink-2)">
                        {a.line}
                      </span>
                    ) : null}
                    <span className="mt-1 block truncate text-[12px] text-(--ui-ink-2)">
                      {WHY[a.why]} · {a.source} · {relative(new Date(a.at))}
                    </span>
                  </span>
                  {a.seen ? null : (
                    <span
                      className="mt-1.5 size-2 shrink-0 bg-(--ui-accent)"
                      role="img"
                      aria-label="New"
                    />
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="border-(--ui-hair) border-t px-4 py-2.5 text-[12.5px] text-(--ui-ink-2)">
          Pick what rings on{" "}
          <a href={`/learn/sources${q}`} onClick={() => setOpen(false)}>
            Sources
          </a>
          .
        </div>
      </PopoverContent>
    </Popover>
  );
}
