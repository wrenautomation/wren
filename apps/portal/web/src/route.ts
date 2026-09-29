/** Hash routes: #/people?filter=moved&person=12. The URL is the state, so back and links work. */
import { useEffect, useState } from "react";

export type Page = "overview" | "people" | "health" | "sources";
export const PAGES: { page: Page; label: string }[] = [
  { page: "overview", label: "Overview" },
  { page: "people", label: "People" },
  { page: "health", label: "Data health" },
  { page: "sources", label: "Sources" },
];

export interface Route {
  page: Page;
  params: URLSearchParams;
}

function parse(): Route {
  const [path = "", query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const page = PAGES.find((p) => p.page === path)?.page ?? "overview";
  return { page, params: new URLSearchParams(query) };
}

export function href(page: Page, params: Record<string, string | number | null | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return `#/${page}${s ? `?${s}` : ""}`;
}

/** Change some params of the current route, keeping the rest. */
export function go(
  page: Page,
  params: Record<string, string | number | null | undefined>,
  keep?: URLSearchParams,
) {
  const merged: Record<string, string | number | null | undefined> = {};
  if (keep) for (const [k, v] of keep) merged[k] = v;
  location.hash = href(page, { ...merged, ...params });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
