/** The `@wren/ui` stories as tests (story-tests.ts). `pnpm --filter @wren/ui test:stories`. */
import { storyTests } from "./story-tests.js";

export default storyTests(import.meta.dirname);
