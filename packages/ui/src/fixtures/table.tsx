/** Fixtures for `table.tsx`: a small table of a template's versions, and positional facts. */
import type { ReactNode } from "react";
import { Skeleton } from "../components/ui/skeleton.js";
import { Tag } from "../controls.js";
import type { TableColumn } from "../table.js";
import { WORST } from "./worst.js";

export interface VersionRow {
  id: string;
  name: string;
  by: string;
  sent: number;
  replies: number;
  state: "live" | "retired" | "failed";
}

export const VERSIONS: VersionRow[] = [
  { id: "v1", name: "First touch", by: "Ada Example", sent: 1240, replies: 61, state: "live" },
  { id: "v2", name: "Follow-up", by: "Ben Example", sent: 880, replies: 24, state: "live" },
  { id: "v3", name: "Last nudge", by: "Cy Example", sent: 310, replies: 4, state: "retired" },
];

export const WORST_VERSIONS: VersionRow[] = [
  {
    id: "w1",
    name: WORST.longName,
    by: WORST.email,
    sent: WORST.hugeCount,
    replies: WORST.negative,
    state: "failed",
  },
  { id: "w2", name: WORST.nonLatin, by: WORST.rtl, sent: WORST.zero, replies: 0, state: "live" },
  { id: "w3", name: WORST.emoji, by: WORST.shortName, sent: 7, replies: 2, state: "live" },
  { id: "w4", name: WORST.empty, by: WORST.empty, sent: 0, replies: 0, state: "retired" },
];

const TONE = { live: "green", retired: "neutral", failed: "warn" } as const;

/** The columns for `VERSIONS`; `cell` can swap each cell, to draw a read that has not landed. */
export function versionColumns(
  cell: (say: ReactNode, row: VersionRow) => ReactNode = (say) => say,
): TableColumn<VersionRow>[] {
  return [
    { key: "name", label: "Version", cell: (r) => cell(r.name, r) },
    { key: "by", label: "Written by", cell: (r) => cell(r.by, r) },
    { key: "sent", label: "Sent", end: true, cell: (r) => cell(r.sent.toLocaleString("en-US"), r) },
    {
      key: "replies",
      label: "Replies",
      end: true,
      cell: (r) => cell(r.replies.toLocaleString("en-US"), r),
    },
    {
      key: "state",
      label: "State",
      cell: (r) =>
        cell(
          <Tag tone={TONE[r.state]} dot>
            {r.state}
          </Tag>,
          r,
        ),
    },
  ];
}

/** A cell that has no answer yet: a ghost the width of the text. */
export const ghost = (): ReactNode => <Skeleton className="h-3 w-3/4 bg-(--ui-fill)" />;

/** A row that failed: the reason, in a warn tag. */
export const FAILED_ROWS: VersionRow[] = VERSIONS.map((v) => ({ ...v, state: "failed" }));

export const FACTS_HEAD = ["Source", ["Visits", "r"], ["Booked", "r"]] as const;
export const FACTS_ROWS: ReactNode[][] = [
  ["Newsletter", "412", "9"],
  ["LinkedIn post", "208", "4"],
  ["Direct", "97", "2"],
];
export const WORST_FACTS_ROWS: ReactNode[][] = [
  [WORST.longName, String(WORST.hugeCount), String(WORST.negative)],
  [WORST.url, "0", "0"],
  [WORST.nonLatin, "7", "1"],
  [WORST.emoji, "", ""],
];
