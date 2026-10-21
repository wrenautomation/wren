/**
 * Offer lines in Studio: the shape's lines (read once, kept on the device), a line's colour square
 * and its name. A draft or a goal names its line by id (`line`); a plan that names none shows
 * nothing here.
 */
import type { MetroLine } from "@wren/pipeline/metro";
import { cx } from "@wren/ui";
import { offerLinesOf, useShapeNodes } from "../../map/stations.js";

/** The offer lines of the workspace's shape, with the read's own state. */
export function useOfferLines(client: string) {
  const shape = useShapeNodes(client);
  const lines = offerLinesOf(shape.data?.lines);
  return { lines, byId: new Map(lines.map((l) => [l.id, l] as const)), shape };
}

/** A line's colour as its token (`--ui-line-0` to `--ui-line-7`). */
export const lineColour = (l: Pick<MetroLine, "colour"> | undefined) =>
  l?.colour === undefined ? "var(--ui-ink-3)" : `var(--ui-line-${l.colour})`;

/** The colour square before a line's name: 10 px in a row or a picker, 8 px on a card (`small`). */
export function LineMark({
  line,
  small = false,
  className,
}: {
  line: MetroLine | undefined;
  small?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block flex-none",
        small ? "size-2 rounded-[2px]" : "size-2.5 rounded-[3px]",
        className,
      )}
      style={{ background: lineColour(line) }}
    />
  );
}

/** A line's square and name, or nothing when it names none. */
export function LineName({ line, className }: { line: MetroLine | undefined; className?: string }) {
  if (!line) return null;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-2", className)}>
      <LineMark line={line} />
      <span className="min-w-0 truncate">{line.label}</span>
    </span>
  );
}
