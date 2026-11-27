/**
 * `weaver serve` on this Mac, faked for the stories that read it (Research › Runs, Explorer's
 * Weaver and folders). SERVED: the fixture runs; REFUSED: serve is not running. Synthetic.
 */
import { HttpResponse, http, sse } from "msw";
import { SERVE } from "../modules/research/serve.js";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "./data/research.js";

/** a known site's 32 px icon: a round in its colour */
const ICON = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="${fill}"/></svg>`;
const MISS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#ccc"/></svg>';
const DOT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#9aa"/></svg>';

export const SERVED = [
  http.get(`${SERVE}/runs`, () => HttpResponse.json({ v: 1, runs: RESEARCH_ROWS })),
  // every listed run reads as the one fixture view: two runs together share all their sources
  http.get(`${SERVE}/runs/:run`, ({ params }) =>
    RESEARCH_ROWS.some((r) => r.run === params.run)
      ? HttpResponse.json({ ...RESEARCH_VIEW, run: params.run })
      : HttpResponse.json({ error: "no records" }, { status: 404 }),
  ),
  http.get(`${SERVE}/runs/:run/documents/:doc`, ({ params }) =>
    HttpResponse.json({
      id: params.doc,
      url: "https://bakers.example/wholesale-guide",
      title: "A wholesale guide for small bakers",
      media: "text",
      text: "Start with three cafes inside a short drive.",
    }),
  ),
  // site icons as gstatic answers: a known site 32 px, any other a 16 px miss
  http.get("https://t1.gstatic.com/faviconV2", ({ request }) => {
    const site = new URL(request.url).searchParams.get("url") ?? "";
    const fill = /youtube\.com/.test(site) ? "#f03" : /reddit\.com/.test(site) ? "#ff4500" : null;
    return new HttpResponse(fill ? ICON(fill) : MISS, {
      headers: { "content-type": "image/svg+xml" },
    });
  }),
  // video stills: offline, one tinted square
  ...["https://i.ytimg.com/*", "https://pbs.twimg.com/*"].map((u) =>
    http.get(u, () => new HttpResponse(DOT, { headers: { "content-type": "image/svg+xml" } })),
  ),
  // open and quiet: a story sends no change
  sse(`${SERVE}/events`, () => {}),
];

export const REFUSED = [
  http.get(`${SERVE}/*`, () => HttpResponse.error()),
  sse(`${SERVE}/events`, ({ client }) => client.error()),
];
