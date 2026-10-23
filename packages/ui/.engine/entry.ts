/**
 * The engine for claude.ai artifacts: the kit, the metro map and its samples as one script, so a
 * design artifact draws with the app's own code (designs/2026-10-23-artifact-engine.md).
 * The page reads `window.Wren`. The kit is a pick, not all of `src/index.ts`: the whole kit is 3.5 MB.
 */
import "../src/tailwind.css";

export { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from "react";
export { createRoot } from "react-dom/client";
export * from "../src/busy.js";
export { Ring as BusyRing } from "../src/busy.js";
export { Badge as UiBadge } from "../src/components/ui/badge.js";
export { Button as UiButton } from "../src/components/ui/button.js";
export { Input } from "../src/components/ui/input.js";
export * from "../src/controls.js";
export * from "../src/display.js";
export * from "../src/fold.js";
export * from "../src/format.js";
export * from "../src/layout.js";
export * from "../src/marks.js";
export * from "../src/metro/index.js";
export { Ring } from "../src/metro/index.js";
export * from "../src/metro/samples.js";
export * from "../src/steps.js";
export * from "../src/sweep.js";
export * from "../src/switch-bar.js";
export * from "../src/tab-bar.js";
export { applyTheme, PRESETS } from "../src/theme.js";
export * from "../src/timeline.js";
