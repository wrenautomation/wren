/** A lander page's heatmap, drawn on its newest replay in the `/replay` frame (`../../replay.ts`). */
import type { RecordExtras } from "@wren/ui";
import { useState } from "react";
import type { ListPage } from "../../module.js";
import type { HeatData } from "../../replay.js";

type Heat = Omit<HeatData, "snapshot"> & { snapshot: HeatData["snapshot"] | null };
type Frame = Window & { heat?: (data: HeatData) => Promise<{ height: number; missing: number }> };

function HeatMap({ data }: { data: HeatData }) {
  const [height, setHeight] = useState(480);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (error) return <p className="text-sm text-gray-500">{error}</p>;
  return (
    <>
      <iframe
        title="Heatmap"
        src="/replay"
        className="w-full border-0"
        style={{ height }}
        onLoad={(e) => {
          const frame = e.currentTarget.contentWindow as Frame | null;
          if (!frame?.heat) return setError("The heatmap didn't load.");
          frame.heat(data).then(
            (got) => {
              setHeight(got.height);
              if (got.missing)
                setNote(
                  `${got.missing} click${got.missing === 1 ? "" : "s"} landed on parts this version of the page no longer has.`,
                );
            },
            (err: Error) => setError(err.message),
          );
        }}
      />
      {note ? <p className="text-sm text-gray-500">{note}</p> : null}
    </>
  );
}

export const heatExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const heat = (detail as { heat?: Heat } | null)?.heat;
  if (!heat) return { sections: [] };
  const { snapshot } = heat;
  return {
    sections: [
      [
        "Heatmap",
        snapshot ? (
          <HeatMap key="heat" data={{ ...heat, snapshot }} />
        ) : (
          <p key="none" className="text-sm text-gray-500">
            No recorded visit of this page at this width yet, so there's nothing to draw on. The
            counts above still hold.
          </p>
        ),
      ],
    ],
  } satisfies RecordExtras;
};
