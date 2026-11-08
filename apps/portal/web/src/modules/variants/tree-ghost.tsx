/**
 * The subject page before its read lands: a ghost in the tree's own frame (header, facts, brief
 * dot, four batch rows), so the tree takes its place without a jump. Geometry from `G`.
 */
import { Skeleton } from "@wren/ui";
import { G } from "./tree-model.js";
import "./tree.css";

const MID = (G.AX + G.W) / 2;
const rowY = (i: number) => G.TOP + G.GEN * (i + 1);
/** per row: node centres and size */
const ROWS: readonly (readonly [readonly number[], number, number])[] = [
  [[MID - 200, MID - 120, MID, MID + 130, MID + 260], 36, 23],
  [[MID - 170, MID, MID + 180], 46, 29],
  [[MID - 90, MID, MID + 80, MID + 180], 46, 29],
  [[0, 1, 2, 3, 4, 5].map((i) => MID + (i - 2.5) * 58), 46, 29],
];
/** parent → child, as [row, index] */
const EDGES: readonly (readonly [number, number, number, number])[] = [
  [-1, 0, 0, 1],
  [-1, 0, 1, 1],
  [-1, 0, 1, 2],
  [0, 1, 1, 0],
  [1, 1, 2, 0],
  [1, 1, 2, 1],
  [1, 1, 2, 2],
  [1, 2, 2, 3],
];
const at = (r: number, i: number): [number, number] =>
  r < 0 ? [MID, G.TOP] : [ROWS[r]?.[0][i] ?? MID, rowY(r)];
const H = rowY(3) + 40;

export function TreeGhost() {
  return (
    <div className="flex flex-col gap-6" role="status">
      <span className="sr-only">Loading the tree</span>
      {/* the header's own heights: back link, title, brief */}
      <div className="flex flex-col gap-1">
        <div className="flex h-[25px] items-center">
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="flex h-[34px] items-center">
          <Skeleton className="h-6 w-[min(70%,560px)]" />
        </div>
        <div className="flex h-[40px] flex-col justify-center gap-2">
          <Skeleton className="h-3 w-[min(90%,560px)]" />
          <Skeleton className="h-3 w-[min(40%,240px)]" />
        </div>
      </div>
      <div className="vt">
        <div className="flex flex-wrap gap-5">
          {[64, 76, 150, 96].map((w) => (
            <Skeleton key={w} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
        {/* phone: centred on the middle line, as the tree opens on its pick */}
        <div className="flex justify-center overflow-hidden @min-[720px]/main:justify-start">
          <svg
            className="vt-ghost flex-none"
            width={G.W}
            height={H}
            viewBox={`0 0 ${G.W} ${H}`}
            aria-hidden="true"
          >
            {EDGES.map(([r1, i1, r2, i2]) => {
              const [x1, y1] = at(r1, i1);
              const [x2, y2] = at(r2, i2);
              const m = (y1 + y2) / 2;
              return (
                <path
                  key={`${r1}.${i1}-${r2}.${i2}`}
                  d={`M${x1} ${y1}C${x1} ${m},${x2} ${m},${x2} ${y2}`}
                  className="vt-ghost-edge"
                />
              );
            })}
            <rect
              x={G.AX + 20}
              y={rowY(3) - 30}
              width={G.W - G.AX - 20}
              height={60}
              rx={10}
              className="vt-ghost-band"
            />
            <circle cx={MID} cy={G.TOP} r={6} className="vt-ghost-fill" />
            {ROWS.map(([xs, w, h], r) => (
              <g key={xs.join()}>
                <rect
                  x={0}
                  y={rowY(r) - 16}
                  width={70}
                  height={10}
                  rx={5}
                  className="vt-ghost-fill"
                />
                <rect
                  x={0}
                  y={rowY(r) + 2}
                  width={54}
                  height={8}
                  rx={4}
                  className="vt-ghost-fill"
                />
                <line x1={G.AX + 40} x2={G.W} y1={rowY(r)} y2={rowY(r)} className="vt-ghost-row" />
                {xs.map((x) => (
                  <rect
                    key={x}
                    x={x - w / 2}
                    y={rowY(r) - h / 2}
                    width={w}
                    height={h}
                    rx={4}
                    className="vt-ghost-fill"
                  />
                ))}
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
