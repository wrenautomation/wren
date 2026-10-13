/**
 * Marketing → More: every page past the main ones, by what it's for. The sidebar keeps the daily
 * work; these are a click away, and each lights More while it's open.
 */

import { PageHeader, Section } from "@wren/ui";

export interface MoreGroup {
  title: string;
  pages: readonly { label: string; href: string }[];
}

export function MorePage({ groups }: { groups: readonly MoreGroup[] }) {
  return (
    <>
      <PageHeader title="More" lede="Every other Marketing page, by what it's for." />
      <div className="grid items-start gap-x-8 gap-y-6 sm:grid-cols-2">
        {groups.map((g) => (
          <Section key={g.title} title={g.title} className="mt-0!">
            <ul className="m-0 grid list-none gap-1 p-0">
              {g.pages.map((p) => (
                <li key={p.href}>
                  <a
                    href={p.href}
                    className="block py-1 text-[14px] text-(--ui-ink) no-underline hover:underline"
                  >
                    {p.label}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </div>
    </>
  );
}
