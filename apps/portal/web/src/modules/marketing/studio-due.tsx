/**
 * Studio's head: what the plan still asks for this week, a card per piece, and the New row, a card
 * per kind. A due card opens where that piece gets made; a New card opens compose with that kind.
 * The look is the Studio board's (artifact 5kYdr7PN, "Studio · this week" and "Studio on the
 * phone"): leaf cards raised on the canvas, a 5-wide grid on a desk, a row that scrolls on a phone.
 */
import type { Platform } from "@wren/core/content";
import type { MetroLine } from "@wren/pipeline/metro";
import { cx, Icon, LoadFailed, Loading } from "@wren/ui";
import type { ApiError } from "../../api.js";
import { href } from "../../route.js";
import { type Due, placeName } from "./plan.js";
import { offeredFor } from "./studio-common.js";
import { LineMark } from "./studio-lines.js";

/** A leaf card raised on the canvas: paper, the panel's corners, the raise's ring and shade. */
export const CARD =
  "block min-w-0 bg-(--ui-paper) rounded-(--ui-leaf-panel) shadow-(--ui-raise) text-(--ui-ink) no-underline";

/**
 * A card that opens something (New, a due piece): it lifts 1 px on hover with an accent ring, on
 * the spring. Reduced motion keeps the ring and drops the move.
 */
export const LIFT =
  "transition-[box-shadow,transform] duration-200 ease-(--ui-spring) hover:-translate-y-px hover:text-(--ui-ink) hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--ui-active)_60%,transparent),0_6px_18px_-8px_color-mix(in_srgb,var(--ui-umbra)_25%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus) motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** The small label over a part (the board's h2): 13 px, 600, ink-3, the kit's label case and tracking. */
export const EYEBROW =
  "m-0 text-[13px] leading-[18px] font-semibold text-(--ui-ink-3) [letter-spacing:var(--ui-label-tracking)] [text-transform:var(--ui-label-case)] max-sm:text-[12px]";

/** A line's name, or nothing: lines come from the plan and the shape. */
function lineOf(due: Due, lines: ReadonlyMap<string, MetroLine>) {
  return due.line ? lines.get(due.line) : undefined;
}

/**
 * "Still due this week": one slot card per piece. A desk shows them five to a row; a phone scrolls
 * them sideways, 150 px each.
 */
export function DueCards({
  due,
  lines,
  error,
  loading,
  retry,
}: {
  due: Due[];
  lines: ReadonlyMap<string, MetroLine>;
  error?: ApiError | null | undefined;
  loading?: boolean | undefined;
  retry: () => void;
}) {
  if (error && !loading && !due.length) return <LoadFailed error={error} onRetry={retry} />;
  if (loading && !due.length)
    return (
      <Loading shape="cards" lines={5} className="sm:flex-row [&>span]:min-w-0 [&>span]:flex-1" />
    );
  if (!due.length) return null;
  return (
    <ul
      aria-label="Still due this week"
      className="m-0 list-none p-0 max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:scroll-px-4 max-sm:gap-2.5 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[scrollbar-width:none] sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-5 max-sm:[&::-webkit-scrollbar]:hidden"
    >
      {due.map((d) => {
        const line = lineOf(d, lines);
        const where = [...new Set(d.goals.map((g) => placeName(g.platform)))].join(", ");
        const day = d.late ? "today" : "this week";
        const more = d.n > 1 ? `${d.n} to make` : "";
        return (
          <li key={d.piece} className="min-w-0 max-sm:w-[150px] max-sm:flex-none max-sm:snap-start">
            <a
              href={d.make.href}
              className={cx(
                CARD,
                LIFT,
                "flex h-full min-h-[92px] flex-col gap-2 px-4 py-3.5 max-sm:min-h-0 max-sm:gap-1 max-sm:px-3.5 max-sm:py-3 max-sm:[border-radius:6px_20px]",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-(--ui-ink-3) max-sm:gap-1.5 max-sm:font-normal">
                <LineMark line={line} small />
                <span className="min-w-0 truncate">{line?.label ?? "No line"}</span>
                <span
                  className={cx(
                    "ml-auto flex-none font-semibold max-sm:hidden",
                    d.late ? "text-(--ui-warn-ink)" : "text-(--ui-ink-2)",
                  )}
                >
                  {day}
                </span>
              </span>
              <span className="text-[15px] leading-5 font-semibold tracking-[-0.01em] max-sm:tracking-normal">
                {d.name}
              </span>
              {/* A desk says where it goes; a phone adds when, in amber when it is today's. */}
              <span className="text-[12px] text-(--ui-ink-3) max-sm:hidden">
                {[where, more].filter(Boolean).join(" · ") || " "}
              </span>
              <span
                className={cx(
                  "text-[12px] sm:hidden",
                  d.late ? "font-semibold text-(--ui-warn-ink)" : "text-(--ui-ink-3)",
                )}
              >
                {[where, day].filter(Boolean).join(" · ")}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** New: one card per kind. A card opens compose with that kind; the platform chip on top rides along. */
export function NewRow({ params, only }: { params: URLSearchParams; only: Platform | null }) {
  return (
    <nav aria-label="New" className="grid grid-cols-3 gap-3 max-sm:hidden lg:grid-cols-6">
      {offeredFor(only).map((m) => (
        <a
          key={m.id}
          href={href("/content/studio", { make: m.id }, params)}
          className={cx(CARD, LIFT, "flex flex-col gap-2.5 p-4")}
        >
          <Icon name={m.mark} size={20} className="text-(--ui-active)" />
          <span className="text-[14px] leading-5 font-semibold">{m.name}</span>
          <span className="text-[12px] leading-4 text-(--ui-ink-3)">{m.where}</span>
        </a>
      ))}
    </nav>
  );
}
