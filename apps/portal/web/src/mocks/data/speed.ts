/** Back office › System › Speed: made-up timings per route and lane (`console.speed`). */
import type { Row } from "@wren/core/records/serve";
import { ago } from "./shell.js";

type Timing = [route: string, lane: string, calls: number, p50: number, p90: number, p99: number];

const TIMINGS: Timing[] = [
  ["ConsolePortal/recordsCounts", "box", 386, 1.121, 1.813, 2.94],
  ["VariantsConsole/batches", "box", 61, 0.505, 3.977, 5.2],
  ["PipelineConsole/mapRead", "lambda", 31, 0.435, 3.88, 4.61],
  ["ConsolePortal/recordsList", "box", 478, 0.279, 3.519, 4.02],
  ["CanonConsole/references", "box", 14, 0.299, 0.716, 0.8],
  ["PathsConsole/children", "box", 92, 0.031, 0.088, 0.21],
  ["desk/call", "desk", 7, 2.4, 11.6, 14.9],
];

const rows = (span: string): Row[] =>
  TIMINGS.map(([route, lane, calls, p50, p90, p99], i) => ({
    id: `${span}/${route}/${lane}`,
    route,
    lane,
    span,
    calls: span === "day" ? Math.ceil(calls / 5) : calls,
    p50,
    p90,
    p99,
    waitP90: lane === "lambda" ? p90 * 0.7 : 0.012,
    runP90: lane === "lambda" ? p90 * 0.3 : p90 - 0.012,
    failed: i === 1 ? 2 : 0,
    lastAt: ago(i * 0.4 + 0.1),
  }));

export const SPEED_ROWS: Row[] = [...rows("day"), ...rows("week")];
