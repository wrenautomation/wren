import type { StoryObj } from "@storybook/react-vite";
import { IntroPage } from "@wren/ui/storybook/intro";

// the `App/` prefix comes from main.ts
export default { title: "Intro", parameters: { layout: "padded" } };

export const Intro: StoryObj = {
  render: () => (
    <IntroPage
      group="App"
      lede="The portal's real pages on a fake server (web/src/mocks). The Data toolbar picks Tidy, Messy (as prod looks) or Empty (no records)."
      sections={[
        [
          "Wren",
          "Wren's team views: the Map, Today, Campaigns, People, Back office, the side chat.",
        ],
        ["Weaver", "Research runs: live runs, history and one run's graph of claims."],
        ["Vireo", "The variant loop: batches to mark, subjects and their generation tree."],
        ["Client", "A client's portal: Today, Project, Campaigns, People, Back office."],
        ["Lab", "Pages in trial, not in the app yet."],
      ]}
    />
  ),
};
