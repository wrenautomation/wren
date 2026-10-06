/**
 * The session player, framed by Marketing → Sessions (`modules/marketing/sessions.tsx`). Its own
 * page because rrweb rebuilds the recorded page with inline styles and the lander's images and
 * fonts, which only this page's CSP allows (`src/worker.ts`). The frame calls `replay(urls)`.
 */
import "rrweb-player/dist/style.css";
import RrwebPlayer from "rrweb-player";

type Event = { type: number; data?: { width?: number; height?: number } };

async function replay(urls: string[]): Promise<number> {
  const chunks = await Promise.all(
    urls.map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`a chunk answered ${r.status}`);
      return (await r.json()) as Event[];
    }),
  );
  const events = chunks.flat();
  if (events.length < 2) throw new Error("Too short to play.");
  // The meta event (type 4) holds the recorded viewport; keep its shape.
  const meta = events.find((e) => e.type === 4)?.data;
  const width = document.body.clientWidth;
  const height = Math.round(width * Math.min((meta?.height ?? 900) / (meta?.width ?? 1440), 1.6));
  const target = document.getElementById("player");
  if (!target) throw new Error("no player element");
  new RrwebPlayer({ target, props: { events: events as never[], width, height, autoPlay: false } });
  return document.documentElement.scrollHeight;
}

(window as unknown as { replay: typeof replay }).replay = replay;
