/** A call's detail on the Calls page: its transcript as a chat, then each turn's timing. */
import type { RecordExtras } from "@wren/ui";
import type { Line } from "@wren/voice";
import type { CallDetail } from "@wren/voice/records";
import type { ListPage } from "../../module.js";
import { Lines, TurnTimes } from "./bits.js";

export const callExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as CallDetail | null;
  if (!d) return {};
  return {
    sections: [
      [
        "Transcript",
        d.transcript.length ? (
          <ol key="transcript" className="grid gap-2.5">
            <Lines lines={d.transcript as Line[]} />
          </ol>
        ) : (
          "Nothing was said."
        ),
      ],
      ["Turn timing", <TurnTimes key="turns" turns={d.turns} />],
    ],
  } satisfies RecordExtras;
};
