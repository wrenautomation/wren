/** PinBoard: React Flow loads only when a board shows, so first paint never carries it. */
import { lazy, Suspense } from "react";
import type { PinBoardProps } from "./canvas.js";

export type { BoardPin, PinAdd, PinAt, PinBoardProps, PinKind, PinPlace } from "./canvas.js";

const Canvas = lazy(() => import("./canvas.js"));

export function PinBoard(props: PinBoardProps) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-busy="true"
          aria-label="Drawing the board"
          className="w-full border border-(--ui-hair) bg-(--ui-graph)"
          style={{ height: props.height ?? 640 }}
        />
      }
    >
      <Canvas {...props} />
    </Suspense>
  );
}
