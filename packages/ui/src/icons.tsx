/** Line icons on a 16px grid, drawn like the lander's: 1.4 stroke, round ends, no fill. */
import { cx } from "./format.js";

const PATHS = {
  home: "M2.5 7 8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z",
  people:
    "M6 7.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.75 13.25c.35-2.1 2-3.5 4.25-3.5s3.9 1.4 4.25 3.5M10.75 2.9a2.25 2.25 0 0 1 0 4.2M12.1 9.9c1.2.45 2 1.6 2.15 3.35",
  mail: "M2 3.5h12v9H2zM2 4.5l6 4.5 6-4.5",
  reply: "M6.5 4 2.5 8l4 4M2.5 8h7a4 4 0 0 1 4 4v1",
  link: "M6.75 9.25l2.5-2.5M7.25 4.75l1.1-1.1a2.83 2.83 0 0 1 4 4l-1.1 1.1M8.75 11.25l-1.1 1.1a2.83 2.83 0 0 1-4-4l1.1-1.1",
  pulse: "M1.5 8.5h3l1.75-4.5 3.5 8 1.75-3.5h3",
  sliders: "M2.5 4.5h11M2.5 11.5h11M5.5 3v3M10.5 10v3",
  play: "M5 3.25v9.5L12.75 8z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  arrow: "M2.5 8h11M9.5 4l4 4-4 4",
  down: "M4 6.25l4 4 4-4",
  left: "M9.75 4 5.75 8l4 4",
  right: "M6.25 4l4 4-4 4",
  close: "M4 4l8 8M12 4l-8 8",
  check: "M3.5 8.5l3 3 6-7",
  clock: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 4.75V8l2.25 1.5",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  external: "M9.5 2.5h4v4M13.5 2.5l-6 6M11.5 9.5v4h-9v-9h4",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.25 10.25 13.5 13.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={cx("ui-icon", className)}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
