/** Previous and next through a long list, with where you are in it. */
import { Button } from "./controls.js";
import { cx, num } from "./format.js";

export function Pager({
  offset,
  size,
  total,
  onPage,
  className,
}: {
  offset: number;
  size: number;
  total: number;
  onPage: (offset: number) => void;
  className?: string | undefined;
}) {
  if (total <= size) return null;
  return (
    <nav className={cx("ui-pager", className)} aria-label="Pages">
      <span className="ui-pager-at">
        {num(offset + 1)}–{num(Math.min(offset + size, total))} of {num(total)}
      </span>
      <Button
        tone="secondary"
        size="sm"
        disabled={offset === 0}
        onClick={() => onPage(Math.max(0, offset - size))}
      >
        Previous
      </Button>
      <Button
        tone="secondary"
        size="sm"
        disabled={offset + size >= total}
        onClick={() => onPage(offset + size)}
      >
        Next
      </Button>
    </nav>
  );
}
