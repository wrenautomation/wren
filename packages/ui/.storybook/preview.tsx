/**
 * The `@wren/ui` Storybook's preview: the shared frame (frame.tsx) over the kit's stylesheet.
 * Stories pass their data as props or as fixture reads (`src/fixtures/load.ts`), so nothing calls
 * `/api`.
 *
 * The sidebar groups the parts by what they are. A grouped story file sets `id` to its id from
 * before the groups, so story links, shots and looks (looks.ts) keep their ids.
 */
import type { Preview } from "@storybook/react-vite";
import "../src/tailwind.css";
import { preview as frame } from "./frame.js";

const preview: Preview = {
  ...frame,
  parameters: {
    ...frame.parameters,
    options: {
      storySort: {
        order: ["Parts", "Forms", "Lists", "Charts", ["Dashboard", "*"], "Pages", "Metro"],
      },
    },
  },
};

export default preview;
