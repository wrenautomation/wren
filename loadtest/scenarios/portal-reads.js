// The portal's commonest read, the records list, by many people at once: the default view, a
// search, a filtered view with facets, and the next page. Passes when p95 and errors stay in
// bounds at the peak. Run by scripts/loadtest.mjs, which sets INGRESS.
import { check } from "k6";
import http from "k6/http";
import { shape } from "../lib.js";

const INGRESS = __ENV.INGRESS;
const viewer = { email: "load@example.test", operator: true };
const headers = { "content-type": "application/json" };

// The success criteria. A miss fails the run (k6 exits 99).
export const options = shape({
  http_req_failed: ["rate<0.01"],
  "http_req_duration{ask:list}": ["p(95)<500"],
  "http_req_duration{ask:search}": ["p(95)<800"],
  "http_req_duration{ask:facets}": ["p(95)<1500"],
});

const list = (body, ask) =>
  http.post(
    `${INGRESS}/ConsolePortal/recordsList`,
    JSON.stringify({ viewer, record: "email.firm", ...body }),
    { headers, tags: { ask } },
  );

export default function () {
  const first = list({ view: "in_play", limit: 50 }, "list");
  check(first, { "list 200": (r) => r.status === 200 });
  const next = first.status === 200 ? first.json("next") : null;
  if (next) list({ view: "in_play", limit: 50, cursor: next }, "list");
  const q = `Firm ${1 + Math.floor(Math.random() * 9000)}`;
  check(list({ q, limit: 20 }, "search"), { "search 200": (r) => r.status === 200 });
  if (Math.random() < 0.2)
    check(list({ view: "in_play", limit: 50, facets: true }, "facets"), {
      "facets 200": (r) => r.status === 200,
    });
}
