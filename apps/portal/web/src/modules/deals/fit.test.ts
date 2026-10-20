import { describe, expect, it } from "vitest";
import { fitExtras } from "./fit.js";

const at = {} as never;

/** The strings in an element tree, in order. */
function textOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (typeof node === "object" && node !== null && "props" in node)
    return textOf((node as { props: { children?: unknown } }).props.children);
  return [];
}

describe("fitExtras", () => {
  it("shows nothing for a journey with no fit", () => {
    expect(fitExtras(null, at)).toEqual({});
    expect(fitExtras({ trail: [], fit: null }, at)).toEqual({});
  });

  it("shows the score, the reasons and what is not known", () => {
    const got = fitExtras(
      {
        fit: {
          score: 72,
          reasons: ["Industry fits: Dental practice.", "Size 4 does not fit 11-50."],
          unknown: ["roles", "must: Takes new patients"],
        },
      },
      at,
    );
    expect(got.facts).toEqual([["Fit", "72 of 100"]]);
    const [title, body] = got.sections?.[0] ?? [];
    expect(title).toBe("Fit to the offer's profile");
    expect(textOf(body)).toEqual([
      "Industry fits: Dental practice.",
      "Size 4 does not fit 11-50.",
      "Not known yet: roles; must: Takes new patients.",
    ]);
  });
});
