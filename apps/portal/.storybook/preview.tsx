/**
 * The portal Storybook's preview: `@wren/ui`'s frame over the app's stylesheet, and a fake server
 * (MSW) started before each story. A story's answers are `parameters.msw` (`web/src/mocks/`).
 * The `data` toolbar's Messy answers every call as prod looks (`setMessy`, mocks/api.ts).
 * The sidebar sorts pages by how far they are from the artifacts: Revamp (no artifact draws it),
 * Ready to build (an artifact draws it, the page doesn't follow it yet), Done. Each story file
 * keeps its old id, so `pages-wren--<app>` links still open.
 * In kestrel's frame (`?kestrel`), Alt+click posts the element's source (`data-insp-path`,
 * main.ts) and its tagged ancestors' to kestrel, which opens the screen's own file.
 */
import "../web/src/app.css";
import type { Decorator, Preview } from "@storybook/react-vite";
import { preview } from "@wren/ui/storybook/frame";
import { mswLoader } from "msw-storybook-addon/csf3";
import { setMessy } from "../web/src/mocks/api.js";

if (window.parent !== window && new URLSearchParams(location.search).has("kestrel"))
  window.addEventListener(
    "click",
    (e) => {
      if (!e.altKey || e.shiftKey || !(e.target instanceof Element)) return;
      // every tagged ancestor, innermost first: the shared part and the screen that holds it
      const chain: string[] = [];
      for (let el = e.target.closest("[data-insp-path]"); el; ) {
        chain.push(el.getAttribute("data-insp-path") as string);
        el = el.parentElement?.closest("[data-insp-path]") ?? null;
      }
      if (!chain.length) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ kestrel: "source", at: chain[0], chain }, "*");
    },
    true,
  );

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
  parameters: {
    ...preview.parameters,
    options: { storySort: { order: ["Revamp", "Ready to build", "Done"] } },
  },
} satisfies Preview;
