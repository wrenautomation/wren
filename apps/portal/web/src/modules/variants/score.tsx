/**
 * His call on a sample: four zone buttons (a tap sets the zone's score) and a 1-10 scale under
 * them to refine it by tap, drag or arrow keys. Vireo D9: the verdict is the score's zone.
 */
import { cx, Icon } from "@wren/ui";
import { TAP, type Verdict, verdictOf } from "@wrenautomation/vireo/calls";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";

/** Low to high, as the scale runs. */
export const ZONES: { v: Verdict; label: string; icon: "close" | "minus" | "check" | "star" }[] = [
  { v: "bad", label: "Bad", icon: "close" },
  { v: "okay", label: "Okay", icon: "minus" },
  { v: "good", label: "Good", icon: "check" },
  { v: "amazing", label: "Amazing", icon: "star" },
];
export const ZONE_OF = Object.fromEntries(ZONES.map((z) => [z.v, z])) as Record<
  Verdict,
  (typeof ZONES)[number]
>;
/** A call's look: border, wash, ink. */
export const VERDICT_ON = {
  amazing: "border-(--ui-accent) bg-(--ui-accent-wash) text-(--ui-accent)",
  good: "border-(--ui-good) bg-(--ui-good-tint) text-(--ui-good-ink)",
  okay: "border-(--ui-ink-3) bg-(--ui-fill) text-(--ui-ink)",
  bad: "border-(--ui-bad) bg-(--ui-bad-tint) text-(--ui-bad)",
} as const satisfies Record<Verdict, string>;
/** A scale cell's fill, by its zone. */
const CELL_ON = {
  amazing: "bg-(--ui-accent)",
  good: "bg-(--ui-good)",
  okay: "bg-(--ui-ink-3)",
  bad: "bg-(--ui-bad)",
} as const satisfies Record<Verdict, string>;
const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** "Good · 8": the zone and the score. */
export const callLabel = (score: number) => `${ZONE_OF[verdictOf(score)].label} · ${score}`;

export function ScoreBar({
  score,
  onScore,
  staged,
}: {
  score: number | null;
  /** null clears (a tap on the lit zone). */
  onScore: (s: number | null) => void;
  /** On stage: controls hug their words. */
  staged?: boolean;
}) {
  const zone = score == null ? null : verdictOf(score);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  // the cell nearest the pointer: groups differ in width, so no linear map
  const at = (e: PointerEvent) => {
    let best: number | null = null;
    let gap = Number.POSITIVE_INFINITY;
    for (const c of track.current?.querySelectorAll<HTMLElement>("[data-n]") ?? []) {
      const r = c.getBoundingClientRect();
      const d = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      if (d < gap) [gap, best] = [d, Number(c.dataset.n)];
    }
    return best;
  };
  const set = (s: number | null) => s !== score && onScore(s);
  const key = (e: KeyboardEvent) => {
    const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    const to =
      by != null
        ? Math.min(10, Math.max(1, (score ?? TAP.okay) + by))
        : e.key === "Home"
          ? 1
          : e.key === "End"
            ? 10
            : null;
    if (to == null) return;
    e.preventDefault();
    set(to);
  };
  // one grid: each zone's cells sit under its button
  return (
    <div
      className={cx(
        "grid min-w-0 grid-cols-4 gap-x-2 gap-y-1.5",
        staged ? "w-[min(520px,100%)]" : "flex-1 basis-72",
      )}
    >
      {ZONES.map((z) => (
        <button
          type="button"
          key={z.v}
          aria-pressed={zone === z.v}
          onClick={() => set(zone === z.v ? null : TAP[z.v])}
          className={cx(
            "inline-flex h-9 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-(--ui-radius) border px-2 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 pointer-coarse:h-11 max-sm:gap-1 max-sm:px-1.5",
            zone === z.v
              ? VERDICT_ON[z.v]
              : "border-(--ui-hair) text-(--ui-ink-2) hover:bg-(--ui-hover)",
          )}
        >
          {/* lit: the score in the icon's place */}
          {zone === z.v ? (
            <span className="tabular-nums">{score}</span>
          ) : (
            <Icon name={z.icon} size={14} className="max-sm:hidden" />
          )}
          {z.label}
        </button>
      ))}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Score"
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={score ?? undefined}
        aria-valuetext={score == null ? "No call" : callLabel(score)}
        onKeyDown={key}
        onPointerDown={(e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          set(at(e));
        }}
        onPointerMove={(e) => drag.current && set(at(e))}
        onPointerUp={() => {
          drag.current = false;
        }}
        onPointerCancel={() => {
          drag.current = false;
        }}
        className="col-span-4 grid cursor-pointer touch-none grid-cols-4 gap-x-2 rounded-(--ui-radius) py-2 outline-none pointer-coarse:py-[19px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus)"
      >
        {ZONES.map((z) => (
          <div key={z.v} className="flex items-center gap-0.5">
            {SCORES.filter((n) => verdictOf(n) === z.v).map((n) => (
              <span
                key={n}
                data-n={n}
                title={callLabel(n)}
                className={cx(
                  "h-1.5 flex-1 rounded-full transition-colors duration-150",
                  score != null && n <= score && zone ? CELL_ON[zone] : "bg-(--ui-ink-3)/30",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
