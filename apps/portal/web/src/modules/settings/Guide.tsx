/**
 * How to get around the portal, drawn from the live app list: every app by area with what it's
 * for and its pages, then the keys. A new app or page shows here with no edit.
 */
import { FRAME_KEYS, Icon, Key, KeyList, LIST_KEYS, PageHeader, Section } from "@wren/ui";
import { areasOf } from "../../areas.js";
import type { Module } from "../../module.js";
import { appsIn, MODULES } from "../index.js";

const LINK =
  "text-(--ui-ink) underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:decoration-(--ui-ink)";

const pagesOf = (m: Module) => m.pages.filter((p) => !p.hidden);

function App({ m }: { m: Module }) {
  const pages = pagesOf(m);
  const first = pages[0] ?? m.pages[0];
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-(--ui-hair) py-3.5 last:border-b-0">
      <span
        className="row-span-2 grid size-[30px] place-items-center bg-(--ui-fill) text-(--ui-ink)"
        aria-hidden="true"
      >
        <Icon name={m.icon} />
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <a
          className={`${LINK} text-[15px] font-semibold`}
          href={first ? `/${m.id}/${first.id}` : "/"}
        >
          {m.name}
        </a>
        <span className="text-[13.5px] text-(--ui-ink-2)">{m.blurb}</span>
      </div>
      {pages.length > 1 ? (
        <ul className="flex list-none flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {pages.map((p) => (
            <li key={p.id}>
              <a className={`${LINK} text-(--ui-ink-2)`} href={`/${m.id}/${p.id}`}>
                {p.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Guide() {
  const areas = areasOf(appsIn(MODULES, { wren: true, team: true, installed: new Set() }), true);
  return (
    <>
      <PageHeader title="Guide" lede="Where everything is, and the fastest ways to reach it." />
      <Section title="Getting around">
        <ul className="grid max-w-[68ch] list-none gap-2.5 text-[14px] leading-relaxed">
          <li>
            The sidebar lists every app by what it's for. Today, at its top, shows what needs you
            across all of them.
          </li>
          <li>
            Open an app and its pages run down the window's left side. Hover an app in the sidebar
            to see its pages without leaving the one you're on.
          </li>
          <li>
            <Key>⌘</Key> <Key>K</Key> opens any page, record or action by name. Type <em>note:</em>{" "}
            to jot something down.
          </li>
          <li>
            The pin at the top right of a page keeps it under Today. Drag pins to reorder them.
          </li>
          <li>
            Layout, the sliders at the sidebar's foot, sets widths, row height and text size. Drag a
            panel's edge to resize it.
          </li>
        </ul>
      </Section>
      <Section title="Keys">
        <div className="grid max-w-[560px] gap-5">
          <KeyList section={FRAME_KEYS} />
          <KeyList section={LIST_KEYS} />
        </div>
      </Section>
      {areas.map(({ area, apps }) => (
        <Section key={area.id} title={area.label}>
          <ul className="list-none">
            {apps.map((m) => (
              <App key={m.id} m={m} />
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}
