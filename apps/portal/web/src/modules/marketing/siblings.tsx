/**
 * A draft's editor shows the same idea's other platforms (`siblings` on the draft's detail), so
 * every version of one piece is a click apart (designs/2026-10-14-saving-and-ui-audit.md).
 */
import { PLATFORM_SPECS } from "@wren/content/write";
import { cx, PlatformMark, type RecordExtras, Tag, type TagTone } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";

interface Sibling {
  id: string;
  platform: string;
  title: string;
  state: string;
}

const STATES: Record<string, { label: string; tone: TagTone }> = {
  draft: { label: "Waiting on you", tone: "accent" },
  failed: { label: "Failed", tone: "warn" },
  approved: { label: "Scheduled", tone: "neutral" },
  publishing: { label: "Posting now", tone: "neutral" },
  published: { label: "Posted", tone: "green" },
  rejected: { label: "Rejected", tone: "neutral" },
};
const nameOf = (p: string) => PLATFORM_SPECS[p as keyof typeof PLATFORM_SPECS]?.name ?? p;

function Siblings({ rows }: { rows: Sibling[] }) {
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {rows.map((r) => {
        const s = STATES[r.state] ?? { label: r.state, tone: "neutral" as const };
        return (
          <li key={r.id}>
            <a
              href={`/content/drafts/${r.id}`}
              className="flex min-w-0 items-center gap-2.5 rounded-(--ui-radius) px-2 py-1.5 text-[13.5px] text-(--ui-ink) no-underline hover:bg-(--ui-hover)"
            >
              <PlatformMark mark={r.platform} size={15} label={nameOf(r.platform)} />
              {/* w-0: a long title never widens the sheet; it truncates. */}
              <span className="w-0 min-w-0 flex-1 wrap-anywhere whitespace-normal">{r.title}</span>
              <span className={cx("shrink-0 text-[12.5px]", QUIET)}>{nameOf(r.platform)}</span>
              <Tag tone={s.tone}>{s.label}</Tag>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** A section with the idea's other drafts, after what `extras` gives. */
export const withSiblings =
  (extras: NonNullable<ListPage["extras"]>): NonNullable<ListPage["extras"]> =>
  (detail, at) => {
    const base: RecordExtras = extras(detail, at);
    const rows = (detail as { siblings?: Sibling[] } | null)?.siblings ?? [];
    if (!rows.length) return base;
    return {
      ...base,
      sections: [
        ...(base.sections ?? []),
        ["Other platforms", <Siblings key="siblings" rows={rows} />],
      ],
    };
  };
