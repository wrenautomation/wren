/**
 * The one player in the app shell, beside the page and never inside it (bead wa-0m4). A page
 * draws a `PlayerSlot` where its player used to be; this lays the playing element over that slot
 * (fixed, followed every frame, clipped to what the page shows) and docks it bottom-right when
 * the slot goes. The element is never reparented between those two places: an iframe that moves
 * reloads. Only Picture-in-Picture moves it, by hand, and a YouTube iframe there reopens at the
 * current time (see `YouTube` in `./media.tsx`).
 */
import { cx } from "@wren/ui";
import { Maximize2, PictureInPicture2, X } from "@wren/ui/lib/lucide";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clipPath, clippersOf, clipTo } from "./geometry.js";
import { Embed, FileMedia, YouTube } from "./media.js";
import { openPip, pipApi } from "./pip.js";
import type { PlayerItem } from "./store.js";
import { usePlayer, usePlayerStore } from "./use.js";

/** Width over height of what the item shows; null for sound alone. */
export const ratioOf = (item: PlayerItem): number | null =>
  item.media === "audio" ? null : (item.ratio ?? (item.kind === "embed" ? 9 / 16 : 16 / 9));

const BUTTON =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-(--ui-radius) border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-tile) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-active) pointer-coarse:size-11";

function Pick({ item, gen }: { item: PlayerItem; gen: number }): ReactNode {
  if (item.kind === "youtube") return <YouTube key={`${item.id}:${gen}`} item={item} />;
  if (item.kind === "embed") return <Embed key={item.id} item={item} />;
  return <FileMedia key={item.id} item={item} />;
}

export function PlayerHost() {
  const store = usePlayerStore();
  const item = usePlayer((s) => s.item);
  const mode = usePlayer((s) => s.mode);
  const slot = usePlayer((s) => s.slot);
  const wrap = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  // The element the media lives in, moved by hand and only into a Picture-in-Picture window.
  const [box] = useState(() => {
    const el = document.createElement("div");
    el.style.cssText = "width:100%;height:100%";
    return el;
  });
  const [pipWin, setPipWin] = useState<Window | null>(null);
  // A YouTube iframe that moves reloads: a new key reopens it at the current time.
  const [gen, setGen] = useState(0);
  const here = item !== null;

  // The media's home: the host's own holder, until Picture-in-Picture takes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `here` re-runs it when the holder mounts.
  useLayoutEffect(() => {
    const h = holder.current;
    if (h && !pipWin && box.parentNode !== h) h.append(box);
  }, [box, pipWin, here]);

  // The slot's box, followed. Layout moves without a scroll or resize (an image loading above
  // it), so the check runs every frame and writes only when the box changed.
  useLayoutEffect(() => {
    const w = wrap.current;
    if (!w || mode !== "full" || !slot) return;
    let clippers = clippersOf(slot);
    const ro = new ResizeObserver(() => {
      clippers = clippersOf(slot);
    });
    ro.observe(slot);
    let key = "";
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = slot.getBoundingClientRect();
      const clip = clipTo(r, [
        { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
        ...clippers.map((c) => c.getBoundingClientRect()),
      ]);
      const next = [r.left, r.top, r.width, r.height, clipPath(clip)].join();
      if (next === key) return;
      key = next;
      const s = w.style;
      s.left = `${r.left}px`;
      s.top = `${r.top}px`;
      s.width = `${r.width}px`;
      s.height = `${r.height}px`;
      s.clipPath = clipPath(clip);
      s.pointerEvents = clip ? "" : "none";
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      w.style.cssText = "";
    };
  }, [mode, slot]);

  const back = useCallback(
    (win: Window) => {
      // Home first, so the reopened iframe is made where it will load.
      holder.current?.append(box);
      setPipWin((w) => (w === win ? null : w));
      setGen((g) => g + 1);
      store.setPip(false);
    },
    [box, store],
  );
  const toPip = async () => {
    const ratio = item ? ratioOf(item) : null;
    const width = 420;
    const win = await openPip(width, Math.round(width / (ratio ?? 16 / 9))).catch(() => null);
    if (!win) return;
    // Moved before React reopens the iframe, so it loads once, in the new window.
    win.document.body.append(box);
    win.addEventListener("pagehide", () => back(win), { once: true });
    setPipWin(win);
    setGen((g) => g + 1);
    store.setPip(true);
  };
  // Picture-in-Picture over from the store's side: another item, Close or Expand.
  useEffect(() => {
    if (mode === "pip" || !pipWin) return;
    pipWin.close();
  }, [mode, pipWin]);

  if (!item) return null;
  const ratio = ratioOf(item);
  const mini = mode !== "full";
  const wide = (ratio ?? 16 / 9) >= 1;
  return (
    <div
      ref={wrap}
      {...(mini ? { role: "region", "aria-label": "Mini player" } : {})}
      className={cx(
        "fixed flex flex-col overflow-hidden",
        mini
          ? cx(
              "z-40 rounded-(--ui-radius-sheet) border border-(--ui-hair) bg-(--ui-paper) shadow-(--ui-float)",
              "right-4 bottom-4 max-w-[calc(100vw-32px)]",
              "max-[900px]:bottom-[calc(66px+env(safe-area-inset-bottom))]",
              ratio === null || wide
                ? "w-[360px] max-[900px]:left-4 max-[900px]:w-auto"
                : "w-[200px]",
            )
          : cx("z-10", ratio !== null && "bg-black"),
      )}
    >
      {mini ? (
        <div key="bar" className="flex items-center gap-0.5 py-1 pr-1 pl-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-(--ui-ink)">
            {item.title}
          </span>
          <button
            type="button"
            className={BUTTON}
            aria-label="Expand"
            title="Expand"
            onClick={() => store.expand()}
          >
            <Maximize2 size={15} aria-hidden="true" />
          </button>
          {pipApi() && ratio !== null && mode === "mini" ? (
            <button
              type="button"
              className={BUTTON}
              aria-label="Picture in picture"
              title="Picture in picture"
              onClick={() => void toPip()}
            >
              <PictureInPicture2 size={15} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={BUTTON}
            aria-label="Close"
            title="Close"
            onClick={() => store.close()}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div
        ref={holder}
        className="min-h-0 flex-1"
        style={mode === "mini" && ratio !== null ? { aspectRatio: String(ratio) } : undefined}
      >
        {mode === "pip" ? (
          <p className="m-0 px-3 pb-3 text-[13px] text-(--ui-ink-2)">Playing in its own window.</p>
        ) : null}
      </div>
      {createPortal(<Pick item={item} gen={gen} />, box, item.id)}
    </div>
  );
}
