/**
 * Finish (a video's cuts, text, captions and crops) on its own: the render's composition over a
 * synthetic recording. The page that holds it is Wren/Campaigns/Content › Videos.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RecordAct } from "@wren/ui";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FINISH, FINISH_NO_FILE, FINISH_WORDS } from "../../../mocks/data/finish.js";
import { Finish } from "../../../modules/marketing/finish.js";

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
