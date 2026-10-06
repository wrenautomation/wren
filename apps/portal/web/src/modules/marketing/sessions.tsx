/** A recorded lander view played back with rrweb-player, its chunks signed by the worker. */
import type { RecordExtras } from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import type { ListPage } from "../../module.js";

type Replay = { urls: string[] };

function Player({ urls }: Replay) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let player: { $destroy(): void } | null = null;
    let gone = false;
    (async () => {
      const [{ default: RrwebPlayer }, chunks] = await Promise.all([
        import("./replay-player.js"),
        Promise.all(urls.map((u) => fetch(u).then((r) => r.json() as Promise<unknown[]>))),
      ]);
      const events = chunks.flat() as never[];
      if (gone || !box.current) return;
      if (events.length < 2) return setError("Too short to play.");
      const width = Math.min(box.current.clientWidth || 720, 1024);
      // Svelte's own types aren't installed, so its teardown is named here.
      player = new RrwebPlayer({
        target: box.current,
        props: { events, width, height: Math.round(width * 0.6), autoPlay: false },
      }) as unknown as { $destroy(): void };
    })().catch((e: Error) => setError(e.message));
    return () => {
      gone = true;
      player?.$destroy();
    };
  }, [urls]);
  return error ? <p className="text-sm text-gray-500">{error}</p> : <div ref={box} />;
}

export const sessionExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const replay = (detail as { replay?: Replay } | null)?.replay;
  return {
    sections: replay?.urls.length ? [["Replay", <Player key="replay" urls={replay.urls} />]] : [],
  } satisfies RecordExtras;
};
