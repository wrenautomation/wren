/**
 * `weaver serve` on this Mac, faked for the stories that read it (Research › Runs, Explorer's
 * Weaver and folders). SERVED: the fixture runs; REFUSED: serve is not running. Synthetic.
 */
import { HttpResponse, http, sse } from "msw";
import { SERVE } from "../modules/research/serve.js";
import { RESEARCH_ROWS, RESEARCH_VIEW } from "./data/research.js";

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
  // icons and video stills: offline, one tinted square
  ...["https://icons.duckduckgo.com/*", "https://i.ytimg.com/*"].map((u) =>
    http.get(u, () => new HttpResponse(DOT, { headers: { "content-type": "image/svg+xml" } })),
  ),
  // open and quiet: a story sends no change
  sse(`${SERVE}/events`, () => {}),
];

export const REFUSED = [
  http.get(`${SERVE}/*`, () => HttpResponse.error()),
  sse(`${SERVE}/events`, ({ client }) => client.error()),
];
