/** A profile's timeline counted by kind, each count a link to its lines on the Timeline page. */
import { Facts, type RecordExtras } from "@wren/ui";
import { createElement, type ReactNode } from "react";

interface Detail {
  timeline: { kind: string; label: string; count: number; last: string | null; href: string }[];
  total: number;
  href: string;
}

const isDetail = (d: unknown): d is Detail =>
  !!d && typeof d === "object" && Array.isArray((d as Detail).timeline);

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;

function Counts({ detail }: { detail: Detail }) {
  if (!detail.total)
    return <p className="text-(--ui-ink-2)">Nothing has happened with them yet.</p>;
  return (
    <Facts
      items={[
        [
          "Everything",
          <a key="all" href={detail.href}>
            {detail.total} lines
          </a>,
        ],
        ...detail.timeline.map(
          (t) =>
            [
              t.label,
              <a key={t.kind} href={t.href}>
                {t.count} {t.count === 1 ? "line" : "lines"}
                {t.last ? `, last ${day(t.last)}` : ""}
              </a>,
            ] as [string, ReactNode],
        ),
      ]}
    />
  );
}

/** The profile page's Timeline section. */
export const profileExtras = (detail: unknown): RecordExtras =>
  isDetail(detail) ? { sections: [["Timeline", createElement(Counts, { detail })]] } : {};
