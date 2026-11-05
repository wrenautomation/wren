/**
 * A synthetic research web: islands of run → query → page → finding on a grid, the shape
 * birdwatch's /web draws. Seeded, so a story and a bench see the same dots.
 */
import type { WebDot, WebLink } from "../graph/web-model.js";

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

/** About `n` dots: islands of 1 run, 10 queries, 8 pages each, 3 findings a read page. */
export function islandsWeb(n: number): { dots: WebDot[]; links: WebLink[] } {
  const rand = seeded(7);
  const dots: WebDot[] = [];
  const links: WebLink[] = [];
  const per = 1 + 10 + 80 + 3 * 56;
  const islands = Math.max(1, Math.round(n / per));
  const cols = Math.ceil(Math.sqrt(islands));
  for (let i = 0; i < islands; i++) {
    const cx = (i % cols) * 1000;
    const cy = Math.floor(i / cols) * 1000;
    const run = `r${i}`;
    dots.push({
      id: run,
      x: cx,
      y: cy,
      size: 12,
      label: `Run ${i + 1}`,
      color: "--ui-accent",
    });
    for (let q = 0; q < 10; q++) {
      const qa = ((q + 0.5) / 10) * 2 * Math.PI;
      const qid = `${run}q${q}`;
      dots.push({
        id: qid,
        x: cx + 120 * Math.cos(qa),
        y: cy + 120 * Math.sin(qa),
        size: 5,
        label: `Query ${q + 1}`,
        color: "--ui-ink-2",
      });
      links.push({ source: run, target: qid });
      for (let pg = 0; pg < 8; pg++) {
        const pa = qa + ((pg - 3.5) / 8) * ((2 * Math.PI) / 10);
        const pid = `${qid}p${pg}`;
        const read = rand() < 0.7;
        dots.push({
          id: pid,
          x: cx + 300 * Math.cos(pa),
          y: cy + 300 * Math.sin(pa),
          size: 2.5,
          label: `Page ${pg + 1}`,
          color: "--ui-ink",
          faint: !read,
        });
        links.push({ source: qid, target: pid });
        if (!read) continue;
        for (let f = 0; f < 3; f++) {
          const fa = pa + ((f - 1) / 3) * ((2 * Math.PI) / 80);
          const fid = `${pid}f${f}`;
          dots.push({
            id: fid,
            x: cx + 400 * Math.cos(fa),
            y: cy + 400 * Math.sin(fa),
            size: 1.5,
            label: `Finding ${f + 1}`,
            color: rand() < 0.85 ? "--ui-good" : "--ui-bad",
          });
          links.push({ source: pid, target: fid });
        }
      }
    }
  }
  return { dots, links };
}
