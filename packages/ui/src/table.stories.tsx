import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./controls.js";
import {
  FACTS_HEAD,
  FACTS_ROWS,
  FAILED_ROWS,
  ghost,
  VERSIONS,
  versionColumns,
  WORST_FACTS_ROWS,
  WORST_VERSIONS,
} from "./fixtures/table.js";
import { DataTable, FactsTable } from "./table.js";

export default {
  title: "Lists/Table",
  id: "table",
} satisfies Meta;

type Story = StoryObj;

const key = (r: { id: string }) => r.id;
const LOOKS = ["plain", "framed"] as const;

/** The two looks, one under the other. */
export const Default: Story = {
  render: () => (
    <div className="grid gap-8">
      {LOOKS.map((look) => (
        <div key={look}>
          <p className="mb-2 text-[12px] text-(--ui-ink-3)">{look}</p>
          <DataTable columns={versionColumns()} data={VERSIONS} rowKey={key} look={look} />
        </div>
      ))}
    </div>
  ),
};

/** No rows: the heads stay. A `DataTable` has no empty line of its own; the page adds one. */
export const Empty: Story = {
  render: () => (
    <div className="grid gap-8">
      {LOOKS.map((look) => (
        <DataTable key={look} columns={versionColumns()} data={[]} look={look} />
      ))}
    </div>
  ),
};

/** The nearest real state: a table has no loading state, so a page that waits draws ghost cells. */
export const Loading: Story = {
  render: () => (
    <DataTable
      columns={versionColumns(ghost)}
      data={VERSIONS}
      rowKey={key}
      look="framed"
      rowProps={() => ({ "aria-busy": true })}
    />
  ),
};

/** The nearest real state: a table has no error state, so rows that failed say it in a warn tag. */
export const Failed: Story = {
  render: () => (
    <DataTable
      columns={versionColumns()}
      data={FAILED_ROWS}
      rowKey={key}
      look="framed"
      rowProps={() => ({ "data-failed": true })}
    />
  ),
};

/** Long, unbreakable, non-Latin, RTL, emoji and empty cells, and huge and negative numbers. */
export const WorstCase: Story = {
  render: () => (
    <div className="grid gap-8">
      <DataTable columns={versionColumns()} data={WORST_VERSIONS} rowKey={key} look="framed" />
      <DataTable columns={versionColumns()} data={WORST_VERSIONS} rowKey={key} stack />
    </div>
  ),
};

/** Facts from heads and rows of cells. */
export const FactsDefault: Story = {
  render: () => <FactsTable head={FACTS_HEAD} rows={FACTS_ROWS} />,
};

/** No rows: the heads alone. */
export const FactsEmpty: Story = {
  render: () => <FactsTable head={FACTS_HEAD} rows={[]} />,
};

/** The nearest real state: a page that waits fills the cells with ghosts, as cards on a phone. */
export const FactsLoading: Story = {
  render: () => (
    <FactsTable head={FACTS_HEAD} rows={FACTS_ROWS.map(() => [ghost(), ghost(), ghost()])} stack />
  ),
};

/** The nearest real state: a page whose read broke fills the cells with a warn tag. */
export const FactsFailed: Story = {
  render: () => (
    <FactsTable
      head={FACTS_HEAD}
      rows={FACTS_ROWS.map(([source]) => [
        source,
        <Tag key="v" tone="warn">
          Failed
        </Tag>,
        <Tag key="b" tone="warn">
          Failed
        </Tag>,
      ])}
    />
  ),
};

/** Worst-case cells, stacked as cards on a phone. */
export const FactsWorstCase: Story = {
  render: () => <FactsTable head={FACTS_HEAD} rows={WORST_FACTS_ROWS} stack />,
};
