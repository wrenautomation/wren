/** A stub address for stories: the `Place` a record template reads. */
import type { Place } from "../records.js";

/** An address that only reads: links are `#` anchors, so a click never leaves the story. */
export function fakePlace(search = ""): Place {
  const params = new URLSearchParams(search);
  return {
    params,
    link: (change) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(change)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return `#${next}`;
    },
    page: (id) => `#record-${id}`,
    list: "#list",
    go: () => {},
  };
}
