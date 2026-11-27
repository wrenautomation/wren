/**
 * His call on a sample: one 1-10 slider (WA-1442, William 11-25: "instead of a pill based 1-10
 * discrete can we just have a slider that transitions"). The thumb glides between whole scores;
 * a drag saves once, on release. Zone words under the track set the zone's score; the lit one
 * clears. Vireo D9: the verdict is the score's zone.
 */
import { cx, Slider } from "@wren/ui";
import { TAP, type Verdict, verdictOf } from "@wrenautomation/vireo/calls";
import { useState } from "react";

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
  amazing: "border-best bg-(--ui-accent-wash) text-best",
  good: "border-(--ui-good) bg-(--ui-good-tint) text-(--ui-good-ink)",
  okay: "border-(--ui-ink-3) bg-(--ui-fill) text-(--ui-ink)",
  bad: "border-(--ui-bad) bg-(--ui-bad-tint) text-(--ui-bad)",
} as const satisfies Record<Verdict, string>;
/** "Good · 8": the zone and the score. */
export const callLabel = (score: number) => `${ZONE_OF[verdictOf(score)].label} · ${score}`;

/** Each zone's share of the track (half a score past each floor), low to high. */
const BAND = { bad: 2.5, okay: 3, good: 2, amazing: 1.5 } as const satisfies Record<
  Verdict,
  number
>;
/** The track's fill, by zone. */
const FILL = {
  amazing: "bg-best",
  good: "bg-(--ui-good)",
  okay: "bg-(--ui-ink-3)",
  bad: "bg-(--ui-bad)",
} as const satisfies Record<Verdict, string>;
/** The readout's ink, by zone. */
const INK = {
  amazing: "text-best",
  good: "text-(--ui-good-ink)",
  okay: "text-(--ui-ink)",
  bad: "text-(--ui-bad)",
} as const satisfies Record<Verdict, string>;
/** Thumb and fill glide to a new score; never while a finger holds the thumb. */
const GLIDE =
  "transition-[inset-inline-start,width,background-color] duration-150 ease-out in-data-dragging:transition-none motion-reduce:transition-none";

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
  // the score under the thumb while it moves; saved on release
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? score;
  const zone = shown == null ? null : verdictOf(shown);
  const set = (s: number | null) => {
    setMoving(null);
    if (s !== score) onScore(s);
  };
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col gap-1",
        staged ? "w-[min(520px,100%)]" : "flex-1 basis-72",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cx(
            "w-[92px] shrink-0 text-[13px] font-semibold whitespace-nowrap tabular-nums transition-colors duration-150",
            zone ? INK[zone] : "text-(--ui-ink-3)",
          )}
        >
          {shown == null ? "No call" : callLabel(shown)}
        </span>
        <Slider.Root
          value={shown ?? TAP.okay}
          min={1}
          max={10}
          step={1}
          onValueChange={(v) => setMoving(v as number)}
          onValueCommitted={(v) => set(v as number)}
          className="min-w-0 flex-1"
        >
          <Slider.Control className="flex h-9 cursor-pointer touch-none items-center pointer-coarse:h-11">
            <Slider.Track className="relative h-1.5 w-full rounded-full bg-(--ui-ink-3)/25">
              {zone && <Slider.Indicator className={cx("rounded-full", FILL[zone], GLIDE)} />}
              <Slider.Thumb
                aria-label="Score"
                getAriaValueText={(_, v) =>
                  score == null && moving == null ? "No call" : callLabel(v)
                }
                className={cx(
                  "size-4 rounded-full border border-(--ui-hair) bg-(--ui-tile) shadow-(--ui-float) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus) pointer-coarse:size-6",
                  GLIDE,
                  shown == null && "opacity-0 focus-visible:opacity-100",
                )}
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      </div>
      {/* zone words sit under their band of the track */}
      <div
        className="ml-[104px] grid text-[12px]"
        style={{ gridTemplateColumns: ZONES.map((z) => `${BAND[z.v]}fr`).join(" ") }}
      >
        {ZONES.map((z, i) => (
          <button
            type="button"
            key={z.v}
            aria-pressed={zone === z.v}
            onClick={() => set(zone === z.v ? null : TAP[z.v])}
            className={cx(
              "min-w-0 cursor-pointer rounded-(--ui-radius) py-1 whitespace-nowrap transition-colors duration-150 hover:text-(--ui-ink)",
              i === 0 ? "text-left" : i === ZONES.length - 1 ? "text-right" : "text-center",
              zone === z.v ? cx("font-semibold", INK[z.v]) : "text-(--ui-ink-3)",
            )}
          >
            {z.label}
          </button>
        ))}
      </div>
    </div>
  );
}
