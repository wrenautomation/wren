/**
 * The `@wren/ui` Storybook's preview: the shared frame (frame.tsx) over the kit's stylesheet.
 * Stories pass their data as props or as fixture reads (`src/fixtures/load.ts`), so nothing calls
 * `/api`.
 */
import "../src/tailwind.css";
import { preview } from "./frame.js";

export default preview;
