/**
 * Where a page wants its player. The page draws this box; the host (`./host.tsx`) plays over it.
 * The item is the page's description of what plays here: the same `id` is the same player, so
 * coming back to a page picks the running player up instead of starting another.
 *
 *   eager    Plays as the page opens, if the player is free or already has this item.
 *   replace  With `eager`: plays even when something else is playing (a page made for this item).
 *   Neither  A Play button, for a page with many (the Shorts under a video).
 */
import { cx, Icon } from "@wren/ui";
import { useLayoutEffect, useRef } from "react";
import type { PlayerItem } from "./store.js";
import { usePlayer, usePlayerStore } from "./use.js";

type Slotted = Omit<PlayerItem, "back"> & { back?: string };

export function PlayerSlot({
  item,
  eager = false,
  replace = false,
  className,
}: {
  item: Slotted;
  eager?: boolean;
  replace?: boolean;
  /** The box's size: the player fills it. */
  className?: string;
}) {
  const store = usePlayerStore();
  const current = usePlayer((s) => s.item?.id === item.id);
  const away = usePlayer((s) => s.item?.id === item.id && s.mode !== "full");
  const box = useRef<HTMLDivElement>(null);
  const sound = item.media === "audio";
  // The page's item as it is now, so a page that redraws never leaves the player a stale callback.
  const latest = useRef(item);
  latest.current = item;
  const asked = useRef<string | null>(null);

  const plain = (): PlayerItem => {
    const now = latest.current;
    return {
      ...now,
      back: now.back ?? location.pathname + location.search,
      onTime: (...a) => latest.current.onTime?.(...a),
    };
  };

  // Plays on its own once per item, never again after Close.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `plain` reads the latest item.
  useLayoutEffect(() => {
    if (!eager || asked.current === item.id) return;
    asked.current = item.id;
    const s = store.getState();
    if (replace || !s.item || s.item.id === item.id) store.play(plain(), { anchor: box.current });
  }, [store, eager, replace, item.id]);
  // Holds the player while this is its item, lets it go to the dock when the page goes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `plain` reads the latest item.
  useLayoutEffect(() => {
    const node = box.current;
    if (!node || !current) return;
    store.play(plain(), { anchor: node });
    return () => store.release(node);
  }, [store, current]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div ref={box} className={cx("relative", sound ? "bg-(--ui-tile)" : "bg-black", className)}>
        {!current ? (
          <button
            type="button"
            className={cx(
              "absolute inset-0 grid size-full cursor-pointer place-items-center border-0 focus-visible:outline-2 focus-visible:outline-(--ui-active)",
              sound
                ? "bg-(--ui-tile) text-(--ui-ink) hover:bg-(--ui-hair)"
                : "bg-black/80 text-white hover:bg-black/70",
            )}
            aria-label={`Play ${item.title}`}
            onClick={() => store.play(plain(), { anchor: box.current })}
          >
            <Icon name="play" size={28} />
          </button>
        ) : away ? (
          <div className="absolute inset-0 grid place-items-center content-center gap-2 bg-(--ui-tile) p-3 text-center text-[13px] text-(--ui-ink-2)">
            Playing in the corner.
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent text-(--ui-ink) underline"
              onClick={() => store.expand()}
            >
              Bring it back here
            </button>
          </div>
        ) : null}
      </div>
      {current && !away ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-(--ui-ink-2) underline hover:text-(--ui-ink)"
            onClick={() => store.dock()}
          >
            Keep playing in the corner
          </button>
        </div>
      ) : null}
    </div>
  );
}
