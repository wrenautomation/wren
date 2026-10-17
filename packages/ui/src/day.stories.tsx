import type { Story, StoryDefault } from "@ladle/react";
import { RecordDay } from "./day.js";
import {
  DAY_ACTS,
  DAY_DRAFTS,
  DAY_POSTS,
  DAY_SOURCES,
  dayApi,
  dayDown,
  dayWaiting,
  WORST_DRAFTS,
  WORST_POSTS,
} from "./fixtures/day.js";
import { fakePlace } from "./fixtures/place.js";

export default { title: "Day" } satisfies StoryDefault;

// One api per story, made once: the reads are keyed by it.
const OK = dayApi(DAY_POSTS, DAY_DRAFTS);
const NONE = dayApi([], []);
const WAITING = dayWaiting();
const DOWN = dayDown();
const WORST = dayApi(WORST_POSTS, WORST_DRAFTS);

const Day = ({ api, search = "" }: { api: typeof OK; search?: string }) => (
  <RecordDay
    title="Today"
    api={api}
    place={fakePlace(search)}
    sources={DAY_SOURCES}
    by="platform"
    acts={DAY_ACTS}
  />
);

/** Today with two posts, drafts that wait (one old, one undated) and the week strip with dots. */
export const Default: Story = () => <Day api={OK} />;

/** A day with no work: the empty line. */
export const Empty: Story = () => <Day api={NONE} />;

/** The types are in and the day's rows never answer: the list skeleton. */
export const Loading: Story = () => <Day api={WAITING} />;

/** The rows' read fails: the page keeps its header and week, and says it could not load. */
export const Failed: Story = () => <Day api={DOWN} />;

/** Long titles and notes, mixed scripts, and thirteen waiting drafts in one group. */
export const WorstCase: Story = () => <Day api={WORST} />;
