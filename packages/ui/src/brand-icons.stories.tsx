import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { BRAND_PATHS, BRAND_REPLACES, type BrandIconName, brandIcon } from "./brand-icons.js";
import { Button } from "./controls.js";
import { Icon, type IconName } from "./icons.js";

// WA-1464: the 25 brand icons for William to judge before wren v2 swaps them into icons.tsx.
// --icon-accent is scoped here only; the app token is wren v2's call.
export default {
  title: "Brand/Icons",
  id: "brand-icons",
} satisfies Meta;

type Story = StoryObj;

const KEYS = Object.keys(BRAND_PATHS) as BrandIconName[];
const DRAWN = Object.fromEntries(KEYS.map((k) => [k, brandIcon(k)])) as Record<
  BrandIconName,
  ReturnType<typeof brandIcon>
>;

/** accent on: purple; html[data-scheme=dark] gets the dark purple */
const SCOPE = `
.bi { --icon-accent: #6b4ee6; }
html[data-scheme="dark"] .bi { --icon-accent: #a996ff; }
.bi .flat { --icon-accent: initial; }
`;

function Scope({ children }: { children: ReactNode }) {
  return (
    <div className="bi" style={{ display: "grid", gap: 40, maxWidth: 1080 }}>
      <style>{SCOPE}</style>
      {children}
    </div>
  );
}

function B({
  name,
  size = 16,
  stroke = 1.6,
}: {
  name: BrandIconName;
  size?: number;
  stroke?: number;
}) {
  const D = DRAWN[name];
  return <D size={size} strokeWidth={stroke} aria-hidden className="flex-none" />;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
        {note ? (
          <p style={{ fontSize: 13, color: "var(--ui-ink-2)", margin: "4px 0 0" }}>{note}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const NAV: [BrandIconName, string][] = [
  ["inbox", "Today"],
  ["workflow", "Map"],
  ["megaphone", "Campaigns"],
  ["building", "Office"],
  ["board", "Board"],
  ["calendar", "Calendar"],
  ["people", "People"],
  ["book", "Canon"],
  ["video", "Studio"],
  ["split", "Variants"],
  ["sliders", "Settings"],
];

/** accent: "all" = every row purple, "active" = only the row you are on */
function Rail({ accent, title }: { accent: "all" | "active"; title: string }) {
  return (
    <div
      style={{
        width: 220,
        display: "grid",
        gap: 2,
        padding: 8,
        borderRadius: 10,
        background: "var(--ui-paper)",
        boxShadow: "inset 0 0 0 1px var(--ui-hair)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ui-ink-3)", padding: "4px 8px 8px" }}>{title}</div>
      {NAV.map(([k, label], i) => {
        const on = i === 2;
        return (
          <div
            key={k}
            className={accent === "active" && !on ? "flat" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 8px",
              borderRadius: 6,
              fontSize: 13.5,
              background: on ? "var(--ui-fill)" : "transparent",
              color: on ? "var(--ui-ink)" : "var(--ui-ink-2)",
              fontWeight: on ? 550 : 450,
            }}
          >
            <B name={k} />
            {label}
          </div>
        );
      })}
    </div>
  );
}

/** a toolbar: brand icons beside the utility ones that stay Lucide */
function Toolbar({ stroke }: { stroke: number }) {
  const lucide: IconName[] = ["down", "copy", "trash", "more", "close"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 12px",
        borderRadius: 8,
        background: "var(--ui-paper)",
        boxShadow: "inset 0 0 0 1px var(--ui-hair)",
        color: "var(--ui-ink-2)",
      }}
    >
      <B name="search" stroke={stroke} />
      <B name="sliders" stroke={stroke} />
      <B name="calendar" stroke={stroke} />
      <span style={{ width: 1, height: 16, background: "var(--ui-hair)" }} />
      {lucide.map((n) => (
        <Icon key={n} name={n} size={16} strokeWidth={stroke} />
      ))}
      <span style={{ fontSize: 12, color: "var(--ui-ink-3)", marginLeft: 8 }}>stroke {stroke}</span>
    </div>
  );
}

export const InUse: Story = {
  render: () => (
    <Scope>
      <Section
        title="Nav rail, 16 px"
        note="Left: purple on every row. Right: purple only on the row you are on, ink on the rest. The right one keeps purple to a tiny accent."
      >
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Rail accent="all" title="A · accent on every row" />
          <Rail accent="active" title="B · accent on the active row" />
        </div>
      </Section>
      <Section
        title="Toolbar: brand icons, then Lucide"
        note="First three are brand; after the rule, Lucide utility icons at the same stroke. Tuning = one stroke for both sets."
      >
        <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
          <Toolbar stroke={1.6} />
          <Toolbar stroke={1.75} />
          <Toolbar stroke={2} />
        </div>
      </Section>
      <Section
        title="States: where purple drops out"
        note="Primary, disabled and danger set the accent to the ink, so the icon is one colour."
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Button tone="secondary">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <B name="mail" /> Send email
            </span>
          </Button>
          <span className="flat">
            <Button tone="primary">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <B name="phone" /> Start call
              </span>
            </Button>
          </span>
          <span className="flat">
            <Button tone="secondary" disabled>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <B name="calendar" /> Book
              </span>
            </Button>
          </span>
          <span
            className="flat"
            style={{
              color: "var(--ui-bad)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
            }}
          >
            <B name="people" /> Remove people
          </span>
        </div>
      </Section>
      <Section title="Sizes" note="16 in rows and rails, 20 in headers, 24 in empty states.">
        <div style={{ display: "grid", gap: 14 }}>
          {[16, 20, 24].map((s) => (
            <div
              key={s}
              style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}
            >
              <span style={{ width: 28, fontSize: 12, color: "var(--ui-ink-3)" }}>{s}</span>
              {KEYS.filter((k) => k !== "page").map((k) => (
                <B key={k} name={k} size={s} />
              ))}
            </div>
          ))}
        </div>
      </Section>
    </Scope>
  ),
};

export const SideBySide: Story = {
  render: () => (
    <Scope>
      <Section
        title="Brand icon beside the Lucide icon it replaces"
        note="Source: Tabler outline at 1.6, the meaning part purple (canon/brand/wren README). doc and page share one glyph."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 8,
          }}
        >
          {KEYS.map((k) => (
            <div
              key={k}
              style={{
                display: "grid",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: "var(--ui-paper)",
                boxShadow: "inset 0 0 0 1px var(--ui-hair)",
              }}
            >
              <div
                style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--ui-ink)" }}
              >
                <span style={{ color: "var(--ui-ink-3)" }}>
                  <Icon name={k as IconName} size={24} strokeWidth={1.75} />
                </span>
                <B name={k} size={24} />
              </div>
              <div style={{ fontSize: 12.5 }}>{k}</div>
              <div style={{ fontSize: 11.5, color: "var(--ui-ink-3)" }}>
                was {BRAND_REPLACES[k]}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </Scope>
  ),
};
