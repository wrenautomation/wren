/**
 * The portal Storybook's preview: `@wren/ui`'s frame over the app's stylesheet, and a fake server
 * (MSW) started before each story. A story's answers are `parameters.msw` (`web/src/mocks/`).
 * The `data` toolbar's Messy answers every call as prod looks (`setMessy`, mocks/api.ts).
 */
import "../web/src/app.css";
import type { Decorator, Preview } from "@storybook/react-vite";
import { preview } from "@wren/ui/storybook/frame";
import { mswLoader } from "msw-storybook-addon/csf3";
import { setMessy } from "../web/src/mocks/api.js";

const data: Decorator = (Story, { globals }) => {
  setMessy(globals.data === "messy");
  return <Story />;
};

export default {
  ...preview,
  decorators: [data, ...(preview.decorators as Decorator[])],
  globalTypes: {
    ...preview.globalTypes,
    data: {
      description: "The fake server's data: tidy, or as messy as prod",
      toolbar: {
        title: "Data",
        items: [
          { value: "tidy", title: "Tidy" },
          { value: "messy", title: "Messy" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { ...preview.initialGlobals, data: "tidy" },
  loaders: [mswLoader()],
} satisfies Preview;
