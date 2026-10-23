/**
 * An app per row, for the Guide and Systems: its icon and name (opens its first page), what it is
 * for, and the pages or Map nodes it links. One part for both, drawn with `Rows`
 * (designs/2026-10-21-crm-rows-everywhere.md, part 4).
 */
import { Icon, type IconName, type RowsColumn, useNarrow } from "@wren/ui";
import { RowsPanel } from "../work/rows-panel.js";

/** The link style both pages share. */
export const LINK =
  "text-(--ui-ink) underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:decoration-(--ui-ink)";

export interface AppLine {
  id: string;
  name: string;
  icon: IconName;
  blurb: string;
  /** Where its name goes. */
  href: string;
  /** Pages, or Map nodes, it links. */
  links: { id: string; label: string; href: string }[];
}

const Links = ({ links }: { links: AppLine["links"] }) => (
  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
    {links.map((l) => (
      <a key={l.id} className={`${LINK} text-(--ui-ink-2)`} href={l.href}>
        {l.label}
      </a>
    ))}
  </span>
);

export function AppRows({
  apps,
  label,
  linksHead,
}: {
  apps: AppLine[];
  label: string;
  linksHead: string;
}) {
  const narrow = useNarrow();
  // A group where no app has a link (Systems, "Not on the shape") draws no empty column.
  const linked = apps.some((a) => a.links.length > 0);
  const columns: RowsColumn<AppLine>[] = [
    { key: "blurb", label: "For", icon: "lines", min: 220, cell: (a) => a.blurb },
    ...(linked
      ? [
          {
            key: "links",
            label: linksHead,
            icon: "link" as const,
            min: 240,
            cell: (a: AppLine) => <Links links={a.links} />,
          },
        ]
      : []),
  ];
  return (
    <RowsPanel<AppLine>
      rows={apps}
      rowKey={(a) => a.id}
      label={label}
      noun="app"
      columns={narrow ? [] : columns}
      name={{
        label: "App",
        icon: "text",
        min: 200,
        title: (a) => a.name,
        href: (a) => a.href,
        mark: (a) => (
          <span
            className="grid size-[26px] flex-none place-items-center bg-(--ui-fill) text-(--ui-ink)"
            aria-hidden="true"
          >
            <Icon name={a.icon} />
          </span>
        ),
        // A phone's row has room for the name alone: what it is for and its links go under it.
        sub: narrow
          ? (a) => (
              <span className="mt-0.5 grid gap-1 text-[13px] text-(--ui-ink-2)">
                <span>{a.blurb}</span>
                {a.links.length ? <Links links={a.links} /> : null}
              </span>
            )
          : undefined,
      }}
    />
  );
}
