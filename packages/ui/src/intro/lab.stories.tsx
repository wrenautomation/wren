import type { StoryObj } from "@storybook/react-vite";
import { IntroPage } from "../../.storybook/intro.js";

export default { title: "Lab/Intro", parameters: { layout: "padded" } };

export const Intro: StoryObj = {
  render: () => (
    <IntroPage
      group="Lab"
      lede="Experiments only. Nothing here ships; a part that proves itself moves to Components."
      sections={[
        ["Orrery", "Map layouts on trial."],
        ["Astryx Team", "A team page idea (portal Storybook, under App/Lab)."],
      ]}
    />
  ),
};
