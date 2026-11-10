/**
 * Who else is on the video now (designs/2026-11-10-video-editor-pick.md, agent cursor): a line that
 * says who, where and what, and a cursor on the timeline. The page reads it with the video.
 */
import type { Presence } from "@wren/starling-studio/presence";
import { TintSwatch, tintColor } from "@wren/ui";
import { stamp } from "./finish-data.js";

export type { Presence };

/** The edit pass's own name (content `AGENT`). */
const PASS = "agent";
const PART: Record<NonNullable<Presence["part"]>, string> = {
  cuts: "the cuts",
  text: "Text",
  captions: "Captions",
  cover: "Cover",
  shapes: "Shapes",
  shorts: "Shorts",
  layout: "Layout",
  marks: "Marks",
  sound: "the sound",
};
/**
 * Cursor tints start past the ones Fix and Keep use. By name order, not list order: the list is
 * newest first, so a new row would swap two agents' tints.
 */
const tintsOf = (presence: readonly Presence[]) => {
  const order = presence.map((p) => p.who).sort();
  return (who: string) => 5 + order.indexOf(who);
};
const nameOf = (who: string) => (who === PASS ? "The editing agent" : who);
const when = (p: Presence) =>
  p.start === null
    ? null
    : p.end === null
      ? stamp(p.start)
      : `${stamp(p.start)} to ${stamp(p.end)}`;

/** One line per agent or person on the video: who, the part, the moment, what it does. */
export function PresenceLines({
  presence,
  onSeek,
}: {
  presence: readonly Presence[];
  onSeek: (t: number) => void;
}) {
  if (!presence.length) return null;
  const tintOf = tintsOf(presence);
  return (
    <ul aria-label="On this video now" aria-live="polite" className="m-0 grid list-none gap-1 p-0">
      {presence.map((p) => {
        const at = when(p);
        return (
          <li
            key={p.who}
            className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-(--ui-ink-2)"
          >
            <TintSwatch tint={tintOf(p.who)} className="rounded-full" />
            <span className="font-medium text-(--ui-ink)">{nameOf(p.who)}</span>
            <span>{p.part ? `is on ${PART[p.part]}` : "is on this video"}</span>
            {at !== null && p.start !== null ? (
              <>
                <span>at</span>
                <button
                  type="button"
                  onClick={() => onSeek(p.start as number)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-(--ui-link) [font-variant-numeric:tabular-nums] hover:underline pointer-coarse:min-h-11"
                >
                  {at}
                </button>
              </>
            ) : null}
            {p.doing ? <span className="basis-full sm:basis-auto">{p.doing}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Each one's cursor over the timeline's rows: a line at its moment, a band across its range. */
export function PresenceCursors({
  presence,
  x,
}: {
  presence: readonly Presence[];
  x: (s: number) => number;
}) {
  const tintOf = tintsOf(presence);
  return (
    <>
      {presence.map((p) => {
        if (p.start === null) return null;
        const color = tintColor(tintOf(p.who));
        const left = x(p.start);
        return (
          <span
            key={p.who}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0"
            style={{ left, width: p.end === null ? 0 : Math.max(2, x(p.end) - left) }}
          >
            {p.end === null ? null : (
              <span
                className="absolute inset-0"
                style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
              />
            )}
            <span className="absolute top-0 bottom-0 left-0 w-0.5" style={{ background: color }} />
            <span
              className="absolute -top-px left-px size-2.5 -translate-x-1/2 rounded-full"
              style={{ background: color }}
            />
          </span>
        );
      })}
    </>
  );
}
