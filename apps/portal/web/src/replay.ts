/**
 * The session player, framed by Marketing → Sessions (`modules/marketing/sessions.tsx`), and
 * the heatmap, framed by Marketing → Heatmaps (`modules/marketing/heat.tsx`). Its own page
 * because rrweb rebuilds the recorded page with inline styles and the lander's images and
 * fonts, which only this page's CSP allows (`src/worker.ts`). The frame calls `replay(urls)` or
 * `heat(data)`.
 */
import "rrweb-player/dist/style.css";
import RrwebPlayer from "rrweb-player";

type Event = { type: number; timestamp: number; data?: { width?: number; height?: number } };

async function chunk(url: string): Promise<Event[]> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`a chunk answered ${r.status}`);
  return (await r.json()) as Event[];
}

async function replay(urls: string[]): Promise<number> {
  const events = (await Promise.all(urls.map(chunk))).flat();
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

export interface HeatData {
  cells: { path: string; cell: number; clicks: number; rage: number }[];
  /** Views that reached each tenth of the page, top first. */
  bands: number[];
  snapshot: { url: string; w: number };
}

const PALETTE: [number, number, number, number][] = [
  [0, 0, 255, 0],
  [0, 255, 255, 0.25],
  [0, 255, 0, 0.5],
  [255, 255, 0, 0.75],
  [255, 0, 0, 1],
];
/** A 0 to 1 heat to its colour: blue through red, as heatmaps read. */
function colour(t: number): [number, number, number] {
  const i = PALETTE.findIndex((p) => p[3] >= t);
  const hi = PALETTE[Math.max(1, i)] ?? PALETTE[4];
  const lo = PALETTE[Math.max(0, i - 1)] ?? PALETTE[0];
  const f = hi && lo && hi[3] > lo[3] ? (t - lo[3]) / (hi[3] - lo[3]) : 1;
  return [0, 1, 2].map((k) =>
    Math.round((lo?.[k] ?? 0) + ((hi?.[k] ?? 0) - (lo?.[k] ?? 0)) * f),
  ) as [number, number, number];
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/**
 * The page rebuilt from its newest replay's first chunk, shown whole at its recorded width and
 * scaled to fit, with the clicks drawn as heat, rage clicks ringed and how far views got shaded
 * down the side. Returns the height to give the frame, and the clicks on parts the page no
 * longer has.
 */
async function heat(data: HeatData): Promise<{ height: number; missing: number }> {
  const events = await chunk(data.snapshot.url);
  if (events.length < 2) throw new Error("That replay is too short to draw on.");
  const target = document.getElementById("player");
  if (!target) throw new Error("no player element");
  const width = document.body.clientWidth;
  const player = new RrwebPlayer({
    target,
    props: {
      events: events as never[],
      width,
      height: 100,
      autoPlay: false,
      showController: false,
    },
  });
  const replayer = player.getReplayer();
  // The end of the chunk: past the load, the fonts and the first reveals.
  replayer.pause((events.at(-1)?.timestamp ?? 0) - (events[0]?.timestamp ?? 0));
  await frame();
  const iframe = replayer.iframe;
  const doc = iframe.contentDocument;
  if (!doc?.body) throw new Error("The page didn't rebuild.");
  // Reveals that never ran in the recording (hidden until scrolled to) show as at rest.
  doc.documentElement.classList.add("no-motion");
  const style = doc.createElement("style");
  style.textContent = "*{animation:none!important;transition:none!important}";
  doc.head?.append(style);
  for (const el of doc.querySelectorAll<HTMLElement>("[style*='opacity']"))
    if (Number(el.style.opacity) < 0.05) Object.assign(el.style, { opacity: "1", transform: "none" });
  const w = data.snapshot.w;
  iframe.style.width = `${w}px`;
  iframe.width = String(w);
  // Grown to the whole page; twice, as a section sized by the screen grows with it.
  let full = 200;
  for (let i = 0; i < 3; i++) {
    iframe.height = String(full);
    iframe.style.height = `${full}px`;
    await frame();
    const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    if (h === full) break;
    full = h;
  }
  doc.defaultView?.scrollTo(0, 0);
  // Shrunk to fit, never blown up: a phone page shows at phone size.
  const scale = Math.min(1, width / w);
  // The player centres the recorded screen in its frame; the heatmap shows the whole page.
  const outer = target.querySelector<HTMLElement>(".rr-player");
  const box = target.querySelector<HTMLElement>(".rr-player__frame");
  for (const el of [outer, box])
    if (el)
      Object.assign(el.style, { width: `${width}px`, height: `${full * scale}px`, boxShadow: "none" });
  Object.assign(replayer.wrapper.style, {
    position: "absolute",
    left: `${Math.max(0, (width - w * scale) / 2)}px`,
    top: "0",
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
  });
  for (const el of target.querySelectorAll<HTMLElement>(".replayer-mouse, .replayer-mouse-tail"))
    el.style.display = "none";
  await frame();

  // Heat: each click a soft spot, darker where they stack, then coloured. Drawn over the
  // rebuilt page from out here, where the page's own styles can't hide it.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = full;
  Object.assign(canvas.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${w}px`,
    height: `${full}px`,
    pointerEvents: "none",
    zIndex: "10",
  });
  const g = canvas.getContext("2d");
  if (!g) throw new Error("no canvas");
  const max = Math.max(1, ...data.cells.map((c) => c.clicks));
  const scrollY = doc.defaultView?.scrollY ?? 0;
  let missing = 0;
  const rings: [number, number][] = [];
  const found = new Map<string, Element | null>();
  for (const c of data.cells) {
    if (!found.has(c.path)) {
      let el: Element | null = null;
      try {
        el = doc.querySelector(c.path);
      } catch {}
      found.set(c.path, el);
    }
    const el = found.get(c.path);
    const r = el?.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) {
      missing += c.clicks + c.rage;
      continue;
    }
    const x = r.left + ((c.cell % 10) + 0.5) * (r.width / 10);
    const y = r.top + scrollY + (Math.floor(c.cell / 10) + 0.5) * (r.height / 10);
    if (c.clicks) {
      const spot = g.createRadialGradient(x, y, 0, x, y, 28);
      spot.addColorStop(0, `rgba(0,0,0,${Math.min(1, 0.15 + c.clicks / max)})`);
      spot.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = spot;
      g.fillRect(x - 28, y - 28, 56, 56);
    }
    if (c.rage) rings.push([x, y]);
  }
  const img = g.getImageData(0, 0, w, full);
  for (let i = 3; i < img.data.length; i += 4) {
    const a = (img.data[i] ?? 0) / 255;
    if (!a) continue;
    const [r, gr, b] = colour(a);
    img.data[i - 3] = r;
    img.data[i - 2] = gr;
    img.data[i - 1] = b;
    img.data[i] = Math.round(Math.min(0.8, a + 0.2) * 255);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "#e11d48";
  g.lineWidth = 3;
  for (const [x, y] of rings) {
    g.beginPath();
    g.arc(x, y, 16, 0, Math.PI * 2);
    g.stroke();
  }
  // Scroll: each tenth of the page shaded by the share of views that reached it.
  const all = data.bands[0] ?? 0;
  if (all) {
    const band = full / 10;
    g.font = "600 13px system-ui, sans-serif";
    data.bands.forEach((views, i) => {
      const share = views / all;
      g.fillStyle = `rgba(17,17,17,${(1 - share) * 0.35})`;
      g.fillRect(0, i * band, w, band);
      g.fillStyle = "rgba(17,17,17,0.85)";
      g.fillRect(w - 64, i * band + 6, 58, 22);
      g.fillStyle = "#fff";
      g.fillText(`${Math.round(share * 100)}%`, w - 56, i * band + 22);
    });
  }
  replayer.wrapper.append(canvas);
  return { height: Math.ceil(full * scale), missing };
}

Object.assign(window, { replay, heat });
