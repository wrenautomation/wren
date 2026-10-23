/**
 * How to get around the portal, drawn from the live app list: every app by area with what it's
 * for and its pages, then the keys. A new app or page shows here with no edit.
 */
import { FRAME_KEYS, Key, KeyList, LIST_KEYS, PageHeader, Section } from "@wren/ui";
import { areasOf } from "../../areas.js";
import type { Module } from "../../module.js";
import { appsIn, MODULES } from "../index.js";
import { type AppLine, AppRows } from "./app-rows.js";

const pagesOf = (m: Module) => m.pages.filter((p) => !p.hidden);

/** An app as a row: its first page, and every page it has when it has more than one. */
function lineOf(m: Module): AppLine {
  const pages = pagesOf(m);
  const first = pages[0] ?? m.pages[0];
  return {
    id: m.id,
    name: m.name,
    icon: m.icon,
    blurb: m.blurb,
    href: first ? `/${m.id}/${first.id}` : "/",
    links:
      pages.length > 1
        ? pages.map((p) => ({ id: p.id, label: p.label, href: `/${m.id}/${p.id}` }))
        : [],
  };
}

export function Guide() {
  const areas = areasOf(appsIn(MODULES, { wren: true, team: true, installed: new Set() }), true);
  return (
    <>
      <PageHeader title="Guide" lede="Where everything is, and the fastest ways to reach it." />
      <Section title="Getting around">
        <ul className="grid max-w-[68ch] list-none gap-2.5 text-[14px] leading-relaxed">
          <li>
            The sidebar has the Map, Inbox, People, Money and Admin. The Map, at its top, shows your
            business as a graph. Click a node to open the app behind it. Admin, then Systems, lists
            every app.
          </li>
          <li>Open an app and its pages run down the window's left side.</li>
          <li>
            <Key>⌘</Key> <Key>K</Key> opens any page, record or action by name. Type <em>note:</em>{" "}
            to jot something down.
          </li>
          <li>
            The pin at the top right of a page keeps it in the sidebar, under the five. Drag pins to
            reorder them.
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
          <AppRows apps={apps.map(lineOf)} label={`${area.label} apps`} linksHead="Pages" />
        </Section>
      ))}
    </>
  );
}
