import type { Story, StoryDefault } from "@ladle/react";
import type { FakeRecordsOptions } from "./fixtures/records.js";
import { LEAD_META, LEAD_NEEDS, LEADS, useRecordsDemo, WORST_LEADS } from "./fixtures/records.js";
import { Panel, RecordList } from "./records.js";

export default { title: "Records", meta: { bare: true } } as StoryDefault;

type Demo = FakeRecordsOptions & { at?: string; picked?: (string | number)[] };

function Page({ at = "view=all", ...o }: Demo) {
  const { api, place, acts } = useRecordsDemo({ at, ...o });
  return (
    <div className="p-4 sm:p-6">
      <RecordList record={LEAD_META.id} api={api} place={place} acts={acts} needs={LEAD_NEEDS} />
    </div>
  );
}

/** The list in its "All" view: what waits on the viewer first under "Needs you", the rest under "For info". */
export const Default: Story = () => <Page />;

/** Nothing matches: the view's empty line. */
export const Empty: Story = () => <Page rows={[]} at="view=waiting" />;

/** The record types are still being read: the list's skeleton. */
export const Loading: Story = () => <Page types="pending" />;

/** The server refuses the record types: the failed-read card with its Retry. */
export const Failed: Story = () => <Page types="fails" />;

/** Types read, rows never come: the list's own bar over a page still loading. */
export const RowsLoading: Story = () => <Page list="pending" />;

/** Types read, the rows' read fails. */
export const RowsFailed: Story = () => <Page list="fails" />;

/** Rows picked: the bar swaps its count for the selection and the bulk actions. */
export const Bulk: Story = () => <Page at="view=waiting" picked={[1, 2, 4]} />;

/** Long, unbreakable, non-Latin, emoji, huge, negative and missing values in every column. */
export const WorstCase: Story = () => <Page rows={WORST_LEADS} />;

/** A lead open beside its list. */
export const PanelOpen: Story = () => <Page at="view=all&lead=1" />;

function PanelHost(o: Demo & { id?: string }) {
  const { api, place, acts } = useRecordsDemo(o);
  return (
    <Panel
      meta={LEAD_META}
      types={[LEAD_META]}
      id={o.id ?? "1"}
      api={api}
      place={place}
      extras={undefined}
      acts={acts}
      index={0}
      count={LEADS.length}
      step={() => {}}
      rev={0}
      onActed={() => {}}
    />
  );
}

/** One lead in the side panel: head, fields, activity, and its actions. */
export const PanelDefault: Story = () => <PanelHost />;

/** A lead with almost nothing on it: only a name. */
export const PanelEmpty: Story = () => <PanelHost rows={WORST_LEADS} id="5" />;

/** The record's read never answers. */
export const PanelLoading: Story = () => <PanelHost get="pending" />;

/** The record's read fails. */
export const PanelFailed: Story = () => <PanelHost get="fails" />;

/** The worst-case lead in the panel. */
export const PanelWorstCase: Story = () => <PanelHost rows={WORST_LEADS} id="1" />;
