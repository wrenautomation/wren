/**
 * A journey's fit to the offer's ICP (`packages/pipeline/src/icp.ts`), on its detail: the score as
 * a fact, the reasons and the checks with nothing to go on as a section. The light read at a node
 * stores it; a journey with none shows nothing.
 */
import { createElement } from "react";
import type { ListPage } from "../../module.js";

/** `fit` in a journey's detail (`pipeline.journey` `load`). */
interface Fit {
  score: number;
  reasons: string[];
  unknown: string[];
  node_name?: string;
}

export const fitExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const fit = (detail as { fit?: Fit | null } | null)?.fit;
  if (!fit) return {};
  const lines = fit.reasons.map((r) => createElement("li", { key: r }, r));
  return {
    facts: [["Fit", `${fit.score} of 100`]],
    sections: [
      [
        "Fit to the offer's profile",
        createElement(
          "div",
          { className: "grid gap-2 text-[13px]" },
          createElement("ul", { className: "grid gap-1" }, lines),
          fit.unknown.length
            ? createElement("p", null, `Not known yet: ${fit.unknown.join("; ")}.`)
            : null,
        ),
      ],
    ],
  };
};
