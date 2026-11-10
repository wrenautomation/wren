/**
 * Finish (a video's cuts, text, captions and crops) on its own: the render's composition over a
 * synthetic recording. The page that holds it is Wren/Campaigns/Content › Videos.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RecordAct } from "@wren/ui";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FINISH, FINISH_MARKS, FINISH_NO_FILE, FINISH_WORDS } from "../../../mocks/data/finish.js";
import { Finish } from "../../../modules/marketing/finish.js";
import { MARK, MARK_DONE, MARK_DROP, type Mark } from "../../../modules/marketing/finish-marks.js";

const meta: Meta = { title: "Wren/Campaigns/Finish", parameters: { layout: "padded" } };
export default meta;

const act: RecordAct = async () => ({});
/**
 * The recording as a blob link: a file that comes through the fake server's service worker has
 * no seekable range, so a seek past a cut lands on 0.
 */
const recording = async () => ({
  source: URL.createObjectURL(await (await fetch(FINISH.source ?? "")).blob()),
});
const withFile: Pick<StoryObj, "loaders"> = { loaders: [recording] };

/** At rest on the first frame: the text and the first caption word show. */
export const Default: StoryObj = {
  ...withFile,
  render: (_a, { loaded }) => (
    <Finish id="story" data={{ ...FINISH, source: loaded.source }} words={FINISH_WORDS} act={act} />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector("video")).not.toBeNull());
  },
};

/** The 9:16 shape: the crop window over the same picture. */
export const Vertical: StoryObj = {
  ...withFile,
  render: (_a, { loaded }) => (
    <Finish
      id="story-vertical"
      data={{ ...FINISH, source: loaded.source }}
      words={FINISH_WORDS}
      act={act}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("tab", { name: "9:16" }));
  },
};

/** The recording's link ran out: one sentence and Retry; Play is off. */
export const NoFile: StoryObj = {
  render: () => <Finish id="story-gone" data={FINISH_NO_FILE} words={FINISH_WORDS} act={act} />,
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(await view.findByRole("button", { name: "Retry" })).toBeVisible();
    await expect(view.getByRole("button", { name: "Play" })).toBeDisabled();
  },
};

/** Finish with marks the story holds, as the page does from each answer. */
function Marked({
  id,
  source,
  start,
  fail,
}: {
  id: string;
  source: string;
  start: Mark[];
  fail?: boolean;
}) {
  const [marks, setMarks] = useState(start);
  const [removed, setRemoved] = useState<Mark[]>([]);
  const act: RecordAct = async (action, input = {}) => {
    if (fail) throw new Error("The mark was not saved. Try again.");
    if (action === MARK)
      setMarks((m) =>
        [
          ...m,
          {
            ...(input as unknown as Mark),
            id: Math.max(0, ...m.map((x) => x.id)) + 1,
            by: "Sam",
            at: "2026-11-10T16:00:00.000Z",
            done: null,
          },
        ].sort((a, b) => a.start - b.start),
      );
    else if (action === MARK_DONE)
      setMarks((m) =>
        m.map((x) =>
          x.id === input.mark
            ? { ...x, done: { at: "2026-11-10T16:00:00.000Z", by: "Sam", why: null } }
            : x,
        ),
      );
    else if (action === MARK_DROP && input.undo) {
      const back = removed.filter((x) => x.id === input.mark);
      setRemoved((r) => r.filter((x) => x.id !== input.mark));
      setMarks((m) => [...m, ...back].sort((a, b) => a.start - b.start));
    } else if (action === MARK_DROP) {
      setRemoved((r) => [...r, ...marks.filter((x) => x.id === input.mark)]);
      setMarks((m) => m.filter((x) => x.id !== input.mark));
    }
    return {};
  };
  return (
    <Finish id={id} data={{ ...FINISH, source }} words={FINISH_WORDS} marks={marks} act={act} />
  );
}
const openMarks = async (canvasElement: HTMLElement) => {
  const view = within(canvasElement);
  await userEvent.click(await view.findByRole("tab", { name: /Marks/ }));
  return view;
};

/** The Marks panel: the open marks, the box of the one at this moment on the picture, pins below. */
export const Marks: StoryObj = {
  ...withFile,
  render: (_a, { loaded }) => (
    <Marked id="story-marks-open" source={loaded.source} start={FINISH_MARKS} />
  ),
  play: async ({ canvasElement }) => {
    const view = await openMarks(canvasElement);
    // the panel fades in
    await waitFor(() => expect(view.getByRole("region", { name: "Open marks" })).toBeVisible());
    // add one, then close it
    await userEvent.type(view.getByLabelText(/for the editing agent/), "Hold this frame longer.");
    await userEvent.click(view.getByRole("button", { name: "Add mark" }));
    await waitFor(() => expect(view.getByText("Hold this frame longer.")).toBeVisible());
    await userEvent.click(view.getByRole("button", { name: /Closed/ }));
    await expect(await view.findByText(/Lowered the click sound/)).toBeVisible();
  },
};

/** A mark just removed: one line says so and Undo puts it back. */
export const MarksRemoved: StoryObj = {
  ...withFile,
  render: (_a, { loaded }) => (
    <Marked id="story-marks-removed" source={loaded.source} start={FINISH_MARKS} />
  ),
  play: async ({ canvasElement }) => {
    const view = await openMarks(canvasElement);
    const open = await view.findByRole("region", { name: "Open marks" });
    const before = within(open).getAllByRole("listitem").length;
    await userEvent.click(
      within(open).getAllByRole("button", { name: "Remove" })[0] as HTMLElement,
    );
    await expect(await view.findByRole("status")).toHaveTextContent(/is removed/);
    await expect(within(open).getAllByRole("listitem")).toHaveLength(before - 1);
  },
};

/** No mark yet: one line says what a mark is for. */
export const MarksEmpty: StoryObj = {
  ...withFile,
  render: (_a, { loaded }) => <Marked id="story-marks-empty" source={loaded.source} start={[]} />,
  play: async ({ canvasElement }) => {
    const view = await openMarks(canvasElement);
    await waitFor(() => expect(view.getByText(/No open marks/)).toBeVisible());
  },
};

/** A mark that did not save: one sentence, and his words stay in the box. */
export const MarksNotSaved: StoryObj = {
  ...withFile,
  render: (_a, { loaded }) => (
    <Marked id="story-marks-not-saved" source={loaded.source} start={FINISH_MARKS} fail />
  ),
  play: async ({ canvasElement }) => {
    const view = await openMarks(canvasElement);
    const box = view.getByLabelText(/for the editing agent/);
    await userEvent.type(box, "Cut this.");
    await userEvent.click(view.getByRole("button", { name: "Add mark" }));
    await expect(await view.findByRole("alert")).toHaveTextContent("The mark was not saved.");
    await expect(box).toHaveValue("Cut this.");
  },
};
