/** A recorded lander view, played in the `/replay` frame (`../../replay.ts`) from signed chunk URLs. */
import type { RecordExtras } from "@wren/ui";
import { useState } from "react";
import type { ListPage } from "../../module.js";

type Replay = { urls: string[] };
type Frame = Window & { replay?: (urls: string[]) => Promise<number> };

function Player({ urls }: Replay) {
  const [height, setHeight] = useState(480);
  const [error, setError] = useState<string | null>(null);
  if (error) return <p className="text-sm text-gray-500">{error}</p>;
  return (
    <iframe
      title="Session replay"
      src="/replay"
      className="w-full border-0"
      style={{ height }}
      onLoad={(e) => {
        const frame = e.currentTarget.contentWindow as Frame | null;
        if (!frame?.replay) return setError("The player didn't load.");
        frame.replay(urls).then(setHeight, (err: Error) => setError(err.message));
      }}
    />
  );
}

export const sessionExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const replay = (detail as { replay?: Replay } | null)?.replay;
  return {
    sections: replay?.urls.length ? [["Replay", <Player key="replay" urls={replay.urls} />]] : [],
  } satisfies RecordExtras;
};
