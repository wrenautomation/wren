/**
 * A profile's timeline counted by kind, each count a link to its lines on the Timeline page, and
 * its site visits, read live from the site's log and never stored (Wren's own profiles).
 */
import { Facts, type RecordExtras } from "@wren/ui";
import { createElement, type ReactNode } from "react";

interface Visit {
  at: string;
  text: string;
  href: string | null;
}

interface Detail {
  timeline: { kind: string; label: string; count: number; last: string | null; href: string }[];
  total: number;
  href: string;
  visits?: Visit[] | null;
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

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Visits({ visits }: { visits: Visit[] }) {
  return (
    <div className="grid gap-2">
      <p className="text-(--ui-ink-2)">
        Read live from the site's log by their visitor cookie. Not kept here.
      </p>
      {visits.length ? (
        <Facts
          items={visits.map(
            (v) =>
              [
                when(v.at),
                v.href ? (
                  <a key={`${v.at} ${v.text}`} href={v.href}>
                    {v.text}
                  </a>
                ) : (
                  v.text
                ),
              ] as [string, ReactNode],
          )}
        />
      ) : (
        <p className="text-(--ui-ink-2)">No visits found.</p>
      )}
    </div>
  );
}

/** The profile page's Timeline section, and Site visits when it has a visitor key. */
export const profileExtras = (detail: unknown): RecordExtras =>
  isDetail(detail)
    ? {
        sections: [
          ["Timeline", createElement(Counts, { detail })],
          ...(detail.visits
            ? [
                ["Site visits", createElement(Visits, { visits: detail.visits })] as [
                  string,
                  ReactNode,
                ],
              ]
            : []),
        ],
      }
    : {};
