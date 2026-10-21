/**
 * Studio's head: what the plan still asks for this week, a card per piece, and the New row, a card
 * per kind. A due card opens where that piece gets made; a New card opens compose with that kind.
 */
import type { Platform } from "@wren/core/content";
import type { MetroLine } from "@wren/pipeline/metro";
import { cx, Icon, LoadFailed, Loading } from "@wren/ui";
import type { ApiError } from "../../api.js";
import { href } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { type Due, placeName } from "./plan.js";
import { offeredFor } from "./studio-common.js";
import { LineName } from "./studio-lines.js";

/** A leaf panel as a card: the design language's corners, a hair border, paper. */
const CARD =
  "block min-w-0 border border-(--ui-hair) bg-(--ui-paper) [border-radius:var(--ui-leaf-panel)] text-(--ui-ink) no-underline transition-colors duration-150 hover:bg-(--ui-wash)";

/** The small label over a part: the kit's label case and tracking, not a new style. */
export const EYEBROW =
  "m-0 font-semibold text-[12px] text-(--ui-ink-2) [letter-spacing:var(--ui-label-tracking)] [text-transform:var(--ui-label-case)]";

/** A line's name, or nothing: lines come from the plan and the shape. */
function lineOf(due: Due, lines: ReadonlyMap<string, MetroLine>) {
  return due.line ? lines.get(due.line) : undefined;
}

/** "Still due this week": one slot card per piece, a row that scrolls sideways when it is long. */
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
  if (loading && !due.length) return <Loading lines={2} />;
  if (!due.length) return null;
  return (
    <ul
      aria-label="Still due this week"
      className="-mx-4 m-0 flex list-none snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {due.map((d) => {
        const line = lineOf(d, lines);
        const where = [...new Set(d.goals.map((g) => placeName(g.platform)))].join(", ");
        const day = d.late ? "today" : "this week";
        return (
          <li key={d.piece} className="w-[220px] flex-none snap-start max-sm:w-[78%]">
            <a href={d.make.href} className={cx(CARD, "grid h-full content-start gap-1 px-4 py-3")}>
              <span className="flex min-h-5 items-center justify-between gap-2 text-[12.5px] text-(--ui-ink-2)">
                {line ? <LineName line={line} /> : <span />}
                {d.n > 1 ? <span className="tabular-nums">{d.n} to make</span> : null}
              </span>
              <span className="font-semibold text-[15.5px] leading-snug">{d.name}</span>
              <span
                className={cx(
                  "text-[12.5px]",
                  d.late ? "font-semibold text-(--ui-warn-ink)" : "text-(--ui-ink-2)",
                )}
              >
                {where ? `${where} · ${day}` : day}
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
    <nav
      aria-label="New"
      className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] max-sm:hidden"
    >
      {offeredFor(only).map((m) => (
        <a
          key={m.id}
          href={href("/content/studio", { make: m.id }, params)}
          className={cx(CARD, "grid content-start gap-3 px-4 py-3.5")}
        >
          <Icon name={m.mark} size={18} className="text-(--ui-active)" />
          <span className="grid gap-0.5">
            <span className="font-semibold text-[14.5px]">{m.name}</span>
            <span className={cx("text-[12.5px] leading-snug", QUIET)}>{m.where}</span>
          </span>
        </a>
      ))}
    </nav>
  );
}
