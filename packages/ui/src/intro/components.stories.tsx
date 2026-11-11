import type { StoryObj } from "@storybook/react-vite";
import { IntroPage } from "../../.storybook/intro.js";

export default { title: "Components/Intro", parameters: { layout: "padded" } };

export const Intro: StoryObj = {
  render: () => (
    <IntroPage
      group="Components"
      lede="The shared parts every page is built from, one story per part, grouped by where they sit in the UI."
      sections={[
        ["Shell and nav", "The frame's own marks: the leaf corner and the sweep."],
        ["Lists", "Records lists, rows, tables, the list bar and the peek."],
        ["Forms", "Edit forms, the draft box and account pickers."],
        ["Controls and feedback", "Buttons, actions, busy and done, confirm, steps and diffs."],
        ["Charts and graphs", "Every chart, the dashboard, ribbons and weaver's run graph."],
        ["Agent chat", "The thread, the chats list, the side panel and weaver's card."],
        ["Map", "The Orrery map and its money models."],
      ]}
    />
  ),
};
