/**
 * Layout directions to look at, not to use: static mocks drawn beside the live sidebar
 * (designs/2026-11-04-portal-places.md, Lean places). No data, no routes.
 */
import { Callout, Icon, type IconName, PageHeader, Section } from "@wren/ui";

interface Item {
  label: string;
  icon: IconName;
  /** Greyed: a product the workspace lacks. */
  locked?: true;
  /** Lit, as the open place. */
  on?: true;
}
interface Group {
  label: string;
  items: Item[];
}

const LEAN: Group[] = [
  {
    label: "",
    items: [
      { label: "Map", icon: "workflow" },
      { label: "Today", icon: "inbox" },
    ],
  },
  {
    label: "",
    items: [
      { label: "Campaigns", icon: "megaphone", on: true },
      { label: "Research", icon: "search" },
    ],
  },
  {
    label: "",
    items: [
      { label: "People", icon: "people" },
      { label: "Back office", icon: "building" },
    ],
  },
];

const SHELL: Group[] = [
  {
    label: "Fixed",
    items: [
      { label: "Today", icon: "inbox" },
      { label: "Results", icon: "chart" },
    ],
  },
  {
    label: "Products",
    items: [
      { label: "Content", icon: "write", on: true },
      { label: "Outbound", icon: "mail" },
      { label: "Research", icon: "search" },
      { label: "Paid ads", icon: "billboard", locked: true },
      { label: "Newsletter", icon: "mail", locked: true },
    ],
  },
  {
    label: "Core",
    items: [
      { label: "Map", icon: "workflow" },
      { label: "People", icon: "people" },
      { label: "Back office", icon: "building" },
    ],
  },
];

const LEAN_TABS = ["Overview", "Plan", "Studio", "Content", "Engage", "Cold email"];
/** A product's four slots, in order. */
const SHELL_TABS = ["Overview", "Make", "Results", "Settings"];

// a picture of a sidebar, so no nav landmark
function Sidebar({ groups }: { groups: Group[] }) {
  return (
    <div className="grid content-start gap-3 rounded-lg border border-(--ui-hair) bg-(--ui-paper) p-2">
      {groups.map((g, i) => (
        <div key={g.label || i} className="grid gap-0.5">
          {g.label ? (
            <span className="px-2 pt-1 text-[11px] font-medium tracking-wide text-(--ui-ink-3) uppercase">
              {g.label}
            </span>
          ) : null}
          {g.items.map((it) => (
            <span
              key={it.label}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] ${
                it.on
                  ? "bg-(--ui-accent-wash) text-(--ui-ink)"
                  : it.locked
                    ? "text-(--ui-ink-3) opacity-60"
                    : "text-(--ui-ink-2)"
              }`}
            >
              <Icon name={it.icon} size={15} />
              {it.label}
              {it.locked ? <span className="ml-auto text-[11px]">add</span> : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Tabs({ tabs }: { tabs: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-(--ui-hair) pb-2">
      {tabs.map((t, i) => (
        <span
          key={t}
          className={`rounded-md px-2.5 py-1 text-[13px] ${
            i === 0 ? "bg-(--ui-accent-wash) text-(--ui-ink)" : "text-(--ui-ink-2)"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function Shot({
  title,
  note,
  groups,
  place,
  tabs,
}: {
  title: string;
  note: string;
  groups: Group[];
  place: string;
  tabs: string[];
}) {
  return (
    <figure className="grid min-w-0 content-start gap-3">
      <figcaption className="grid gap-1">
        <b className="text-[14px] text-(--ui-ink)">{title}</b>
        <span className="text-[13px] text-(--ui-ink-2)">{note}</span>
      </figcaption>
      <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3">
        <Sidebar groups={groups} />
        <div className="grid content-start gap-3 rounded-lg border border-(--ui-hair) p-3">
          <b className="text-[15px] text-(--ui-ink)">{place}</b>
          <Tabs tabs={tabs} />
          <div className="grid gap-2">
            {[70, 55, 82].map((w) => (
              <span key={w} className="h-2.5 rounded bg-(--ui-fill)" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export function Experiments() {
  return (
    <>
      <PageHeader
        title="Experiments"
        lede="Layout directions to look at. Nothing here is live or saved."
      />
      <Callout>
        Lean places is the live shape. The product shell is one way to grow it once more products
        sell: a fixed shell, then one place per product with four tabs.
      </Callout>
      <Section title="Product shell">
        <div className="grid gap-8 lg:grid-cols-2">
          <Shot
            title="Live: lean places"
            note="Places by job. Campaigns holds content, outreach and cold email."
            groups={LEAN}
            place="Campaigns"
            tabs={LEAN_TABS}
          />
          <Shot
            title="Mock: product shell"
            note="Places by product. A client sees what it bought; the rest is greyed with Add."
            groups={SHELL}
            place="Content"
            tabs={SHELL_TABS}
          />
        </div>
      </Section>
    </>
  );
}
