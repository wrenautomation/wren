import type { Decorator, Preview } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useRef } from "react";
import { QUERIES } from "../src/data/query.js";
import { HintLayer } from "../src/hint-layer.js";
import { PRESETS, usePageTheme } from "../src/theme.js";

/**
 * The frame every story renders in, shared by each Storybook (`@wren/ui/storybook/frame`): the
 * portal's look (the `theme` toolbar's dark wears `night`, which flips the tokens), the one query
 * client and the hover-text layer. Each Storybook's preview adds its own stylesheet. The cache is
 * cleared on each story, so one story's answer never shows in the next.
 */
function Frame({
  id,
  dark,
  bare,
  children,
}: {
  id: string;
  dark: boolean;
  bare: boolean;
  children: ReactNode;
}) {
  usePageTheme(dark ? PRESETS.night : PRESETS.wren);
  // Cleared before the story's first render, so its reads never see the last story's answers.
  const shown = useRef("");
  if (shown.current !== id) {
    shown.current = id;
    QUERIES.clear();
  }
  return (
    <QueryClientProvider client={QUERIES}>
      <div
        style={{
          background: "var(--ui-canvas)",
          color: "var(--ui-ink)",
          fontFamily: "var(--ui-font)",
          minHeight: "100vh",
          padding: bare ? 0 : 24,
        }}
      >
        {children}
      </div>
      <HintLayer />
    </QueryClientProvider>
  );
}

const frame: Decorator = (Story, { id, globals, parameters }) => (
  <Frame id={id} dark={globals.theme === "dark"} bare={parameters.layout === "fullscreen"}>
    <Story />
  </Frame>
);

/** The phone shell switches under 900px (`PHONE`), so a phone width sits in the list. */
const size = (width: number, height: number) => ({ width: `${width}px`, height: `${height}px` });
export const VIEWPORTS = {
  phone: { name: "Phone 390", styles: size(390, 844), type: "mobile" },
  tablet: { name: "Tablet 820", styles: size(820, 1180), type: "tablet" },
  desktop: { name: "Desktop 1280", styles: size(1280, 900), type: "desktop" },
} as const;

export const preview: Preview = {
  decorators: [frame],
  globalTypes: {
    theme: {
      description: "The look: wren (light) or night (dark)",
      // A title, not a Storybook icon: kit-door.test.ts reads `icon: "…"` as one of the kit's.
      toolbar: {
        title: "Theme",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    // Frame pads the story itself (24px), or not for `layout: "fullscreen"`.
    layout: "padded",
    viewport: { options: VIEWPORTS },
    // Every story fails its test on an a11y violation; a known gap says "todo" with a reason.
    a11y: { test: "error" },
  },
};
