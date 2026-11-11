/**
 * The portal's page stories as tests (`@wren/ui/storybook/tests`). The Empty pass runs each file
 * that holds a page story (`pageAt`, mocks/page.tsx) once more with no records.
 * `pnpm --filter @wren/portal test:stories`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { storyTests } from "@wren/ui/storybook/tests";

const root = join(import.meta.dirname, "..");
const pages = readdirSync(join(root, "web/src"), { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".stories.tsx"))
  .map((f) => `web/src/${f}`)
  .filter((f) => readFileSync(join(root, f), "utf8").includes("pageAt("));

export default storyTests(import.meta.dirname, { empty: pages });
