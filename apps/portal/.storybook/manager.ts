/** Redesign first (designs/2026-11-26-redesign.md); the old roots fold shut until it is approved. */
import { addons } from "storybook/manager-api";

addons.setConfig({ sidebar: { collapsedRoots: ["app", "components", "lab", "templates"] } });
