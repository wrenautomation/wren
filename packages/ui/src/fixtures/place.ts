/**
 * Where a record template sits (`Place`), with no router. `fakePlace` is a fixed address: links
 * are `#` anchors, so a click never leaves the story, and several can sit side by side.
 * `usePlace` is a live one kept in the page's hash, so a story's links and tabs really move.
 */
import { useEffect, useMemo, useState } from "react";
import type { EntryKeep, Place } from "../records.js";

/** `params` with `change` on it, as a `#` link. */
const linkOf = (params: URLSearchParams) => (change: Record<string, string | null>) => {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(change)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  return `#${next.toString()}`;
};

/** A fixed address that only reads. */
export function fakePlace(search = ""): Place {
  const params = new URLSearchParams(search);
  return {
    params,
    link: linkOf(params),
    page: (id) => `#record-${id}`,
    list: "#list",
    go: () => {},
  };
}

/**
 * A live address in the page's hash, starting at `initial`; `kept` seeds the entry's memory (a
 * picked set); an open record is `?<one>=<id>`, as the portal's.
 */
export function usePlace(initial = "", kept: Record<string, unknown> = {}, one = "id"): Place {
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeded once per mount.
  const entry = useMemo<EntryKeep>(() => {
    const held = new Map(Object.entries(kept));
    return {
      get: (key) => held.get(key),
      set: (key, value) => void (value === undefined ? held.delete(key) : held.set(key, value)),
    };
  }, []);
  const read = () => new URLSearchParams(location.hash.replace(/^#\??/, "") || initial);
  const [params, setParams] = useState(read);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `initial` is read once per mount.
  useEffect(() => {
    // A story opens at its own address; a reload keeps whatever the hash then says.
    // route-ok: Ladle has no portal router; the fixture owns the story frame's hash.
    if (!location.hash && initial) history.replaceState(null, "", `#${initial}`);
    const on = () => setParams(read());
    addEventListener("hashchange", on);
    return () => {
      removeEventListener("hashchange", on);
      // The next story starts clean, not at this one's address.
      // route-ok: Ladle has no portal router; the fixture owns the story frame's hash.
      history.replaceState(null, "", location.pathname + location.search);
    };
  }, []);
  return useMemo(
    () => ({
      params,
      link: linkOf(params),
      page: (id) => `#${new URLSearchParams({ [one]: String(id) }).toString()}`,
      list: "#",
      entry,
      go: (to) => {
        location.hash = to.replace(/^#/, "");
      },
    }),
    [params, entry, one],
  );
}
