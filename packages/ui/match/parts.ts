/**
 * Artifact match pairs (designs/2026-10-21-artifact-match.md): each part names one artifact node
 * and the same part in a story, with the properties measured on each. `wren-match` reads both
 * computed styles, day and night, at 390 and 1280, and fails on any difference.
 *
 * A prop is one name, read on both sides, or a [artifact, story] pair when the two draw the same
 * thing another way (a border on one side, an inset shadow on the other: the colour is compared).
 *
 * Rows parts the artifact does not draw get no pair: hover, selected, stage squares, late and the
 * group head. The count footer went on 10-22 (the flat app). Add a pair when the artifact draws one.
 */
export type Prop = string | readonly [artifact: string, story: string];

export type Part = {
  name: string;
  /** The artifact file under `designs/`, and its node. */
  artifact: { file: string; at: string };
  /** The story id, and its node at each width (none: the story has no such part at that width). */
  story: { id: string; at: { 390?: string; 1280?: string } };
  props: readonly Prop[];
};

const DL = "2026-10-20-design-language/design-language.html";
const ROW = "#storybook-root [data-row='0']";
const TEXT = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color"];

export const PARTS: readonly Part[] = [
  {
    // The artifact's row is a grid of avatar, two lines and a chip, padded 10px 4px; it has no
    // fill of its own. Its table (`.tw td`, 10px 14px) is the other row it draws: this map pins
    // the people row, and the dense table row is William's call (designs/2026-10-21-artifact-match.md).
    name: "row",
    artifact: { file: DL, at: "#parts .rows > .row" },
    story: { id: "rows--default", at: { 390: `${ROW} > [data-face]`, 1280: ROW } },
    props: ["height"],
  },
  {
    name: "row rule",
    artifact: { file: DL, at: "#parts .rows > .row + .row" },
    story: {
      id: "rows--default",
      at: {
        390: "#storybook-root [data-row='1'] > [data-face]",
        1280: "#storybook-root [data-row='1'] > td:nth-child(2)",
      },
    },
    props: [["border-top-color", "box-shadow"]],
  },
  {
    name: "row name gap",
    artifact: { file: DL, at: "#parts .rows > .row" },
    story: {
      id: "rows--default",
      at: { 390: `${ROW} [data-face] .gap-2`, 1280: `${ROW} td:nth-child(2) .flex-1` },
    },
    props: ["column-gap"],
  },
  {
    name: "row title",
    artifact: { file: DL, at: "#parts .rows > .row b" },
    story: {
      id: "rows--default",
      at: { 390: `${ROW} a[href]`, 1280: `${ROW} td:nth-child(2) a[data-tip]` },
    },
    props: TEXT,
  },
  {
    name: "avatar",
    artifact: { file: DL, at: "#parts .rows > .row .av" },
    story: {
      id: "rows--default",
      at: { 390: `${ROW} span[aria-hidden]`, 1280: `${ROW} td:nth-child(2) span[aria-hidden]` },
    },
    props: [
      "width",
      "height",
      "border-radius",
      "background-color",
      "color",
      "font-size",
      "font-weight",
    ],
  },
  {
    name: "list head",
    artifact: { file: DL, at: "#metro .tw th:nth-child(2)" },
    story: { id: "rows--default", at: { 1280: "#storybook-root thead th:nth-child(2)" } },
    props: [...TEXT, "padding-left", "padding-right", "height"],
  },
];
