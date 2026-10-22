/**
 * Artifact match pairs (designs/2026-10-21-artifact-match.md): each part names one artifact node
 * and the same part in a story, with the properties measured on each. `wren-match` reads both
 * computed styles, day and night, at 390 and 1280, and fails on any difference.
 *
 * A prop is one name, read on both sides, or a [artifact, story] pair when the two draw the same
 * thing another way (a border on one side, an inset shadow on the other: the colour is compared).
 *
 * Rows pins the Design Language's queue table row (`#inbox`, `.nt`, list f1): one line, a 22px
 * avatar, 42px tall. It is the flat, dense row; the two-line row (f2, f4) and the people row
 * (`#parts .rows`) are not lists Rows draws. The flat app (10-22) drops f1's column lines, its
 * raised box and its count footer, so those get no pair. Nor do hover, selected, stage squares,
 * late and the group head yet. Add a pair when a part is drawn on both sides.
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
const ART = "#f1 .r";
const TEXT = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color"];

export const PARTS: readonly Part[] = [
  {
    name: "row",
    artifact: { file: DL, at: ART },
    story: { id: "rows--default", at: { 390: `${ROW} > [data-face]`, 1280: ROW } },
    props: ["height"],
  },
  {
    name: "row rule",
    artifact: { file: DL, at: `${ART} + .r` },
    story: {
      id: "rows--default",
      at: {
        390: "#storybook-root [data-row='1'] > [data-face]",
        1280: "#storybook-root [data-row='1'] > td:nth-child(2)",
      },
    },
    props: ["box-shadow"],
  },
  {
    name: "row name gap",
    artifact: { file: DL, at: `${ART} > span:nth-child(2)` },
    story: {
      id: "rows--default",
      at: { 390: `${ROW} [data-face] .gap-\\[7px\\]`, 1280: `${ROW} td:nth-child(2) .flex-1` },
    },
    props: ["column-gap"],
  },
  {
    name: "row title",
    artifact: { file: DL, at: `${ART} .nm` },
    story: {
      id: "rows--default",
      at: { 390: `${ROW} a[href]`, 1280: `${ROW} td:nth-child(2) a[data-tip]` },
    },
    props: TEXT,
  },
  {
    name: "avatar",
    artifact: { file: DL, at: `${ART} .av` },
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
    artifact: { file: DL, at: "#f1 .hd > span:nth-child(2)" },
    story: { id: "rows--default", at: { 1280: "#storybook-root thead th:nth-child(2)" } },
    props: [...TEXT, "padding-left", "padding-right"],
  },
  {
    name: "list head height",
    artifact: { file: DL, at: "#f1 .hd" },
    story: { id: "rows--default", at: { 1280: "#storybook-root thead th:nth-child(2)" } },
    props: ["height"],
  },
];
