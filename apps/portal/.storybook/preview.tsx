/**
 * The portal Storybook's preview: `@wren/ui`'s frame over the app's stylesheet, and a fake server
 * (MSW) started before each story. A story's answers are `parameters.msw` (`web/src/mocks/`).
 */
import "../web/src/app.css";
import type { Preview } from "@storybook/react-vite";
import { preview } from "@wren/ui/storybook/frame";
import { mswLoader } from "msw-storybook-addon/csf3";

export default { ...preview, loaders: [mswLoader()] } satisfies Preview;
