import "../src/tailwind.css";
import type { GlobalProvider } from "@ladle/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useRef } from "react";
import { QUERIES } from "../src/data/query.js";
import { HintLayer } from "../src/hint-layer.js";
import { PRESETS, usePageTheme } from "../src/theme.js";

/**
 * Every story renders inside the portal's own parts: its stylesheet, its look (Ladle's dark
 * mode wears `night`, which flips the tokens), the one query client and the hover-text layer. Stories pass their data
 * as props or as fixture reads (`src/fixtures/load.ts`), so nothing calls `/api`. The cache is
 * cleared on each story, so one story's answer never shows in the next.
 */
export const Provider: GlobalProvider = ({ children, globalState, storyMeta }) => {
  const dark = globalState.theme === "dark";
  usePageTheme(dark ? PRESETS.night : PRESETS.wren);
  // Cleared before the story's first render, so its reads never see the last story's answers.
  const shown = useRef("");
  if (shown.current !== globalState.story) {
    shown.current = globalState.story;
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
          padding: storyMeta?.bare ? 0 : 24,
        }}
      >
        {children}
      </div>
      <HintLayer />
    </QueryClientProvider>
  );
};
