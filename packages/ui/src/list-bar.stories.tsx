import type { Story, StoryDefault } from "@ladle/react";
import type { RecordMeta } from "@wren/core/records";
import {
  BARE_META,
  facetsOf,
  fakeKeep,
  LEAD_COUNTS,
  type Read,
  WORST_SAVED,
} from "./fixtures/list-bar.js";
import { usePlace } from "./fixtures/place.js";
import { LEAD_META } from "./fixtures/records.js";
import { WORST } from "./fixtures/worst.js";
import type { KeepApi } from "./list-bar.js";
import { type Facets, ListBar, SearchBox, useSavedViews, ViewTabs } from "./list-bar.js";

export default { title: "List bar" } as StoryDefault;

interface Demo {
  meta?: RecordMeta;
  keep?: KeepApi | undefined;
  facets?: Read;
  /** The list's address: the view, the filters and the search on it. */
  at?: string;
  /** `null`: the counts are not in. */
  counts?: Record<string, number> | null;
}

/** The tabs and the bar under them, as a list shows them, on a place kept in the hash. */
function Bar({ meta = LEAD_META, keep = fakeKeep(), facets = "ok", at = "", counts }: Demo) {
  const place = usePlace(at);
  const saved = useSavedViews(keep, meta.id);
  const shown = new Set(meta.fields.map((f) => f.key));
  return (
    <div className="grid gap-3">
      <ViewTabs
        meta={meta}
        current={place.params.get("view") ?? meta.views[0]?.id}
        counts={counts === null ? undefined : (counts ?? LEAD_COUNTS)}
        place={place}
        saved={saved}
        keep={keep}
      />
      <ListBar
        meta={meta}
        place={place}
        shown={shown}
        keep={keep}
        saved={saved}
        facets={facetsOf(facets) as () => Promise<Facets | undefined>}
        end={<span className="text-[13px] text-(--ui-ink-3)">14 leads</span>}
      />
    </div>
  );
}

/** Views as tabs with counts, a saved view of his own and a shared one, search, Filter, and one filter on. */
export const Default: Story = () => <Bar at="view=all&state=waiting" />;

/** A list with no views, no saved views and nothing to search: the bar shows only Filter and the count. */
export const Empty: Story = () => <Bar meta={BARE_META} keep={fakeKeep("ok", [])} counts={null} />;

/**
 * No state of its own: the bar waits on its reads. The saved views never answer (the tabs show
 * the built-in views only) and the counts are not in yet.
 */
export const Loading: Story = () => (
  <Bar keep={fakeKeep("pending")} counts={null} facets="pending" />
);

/**
 * No error state of its own: the saved-views read fails and the bar shows the built-in views
 * without them, without a message.
 */
export const Failed: Story = () => <Bar keep={fakeKeep("fails")} facets="fails" />;

/** Six saved views past the tab limit, long and non-Latin names, a long search, filters on. */
export const WorstCase: Story = () => (
  <Bar
    keep={fakeKeep("ok", WORST_SAVED)}
    at={`view=all&sv=11&state=waiting&q=${encodeURIComponent(WORST.longText.slice(0, 120))}`}
    counts={{ waiting: WORST.hugeCount, approved: 0, all: WORST.hugeCount }}
  />
);

/** The search box alone, with a typed query. */
export const SearchDefault: Story = () => {
  const place = usePlace("q=northwind");
  return <SearchBox place={place} label="leads" />;
};
