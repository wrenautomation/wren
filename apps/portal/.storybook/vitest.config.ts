/** The portal's page stories as tests (`@wren/ui/storybook/tests`). `pnpm --filter @wren/portal test:stories`. */
import { storyTests } from "@wren/ui/storybook/tests";

export default storyTests(import.meta.dirname);
