import type { StoryObj } from "@storybook/react-vite";
import { IntroPage } from "../../.storybook/intro.js";

export default { title: "Templates/Intro", parameters: { layout: "padded" } };

export const Intro: StoryObj = {
  render: () => (
    <IntroPage
      group="Templates"
      lede="Page templates from @wren/ui on sample data: the frame and the page shapes an app fills."
      sections={[
        ["Day", "A records page by day (RecordDay): each day's records under its date."],
        [
          "Overview",
          "A place's first page (RecordOverview): tiles of numbers, then queues of what waits.",
        ],
        ["Shell", "The whole frame (AppShell): sidebar, header and the page area."],
      ]}
    />
  ),
};
