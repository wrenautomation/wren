/** Website changes (S7): Wayback CDX, then our own monthly read. Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const site = defineCollector({
  name: "site",
  subject: "company",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 200, burst: 20 },
  everyDays: 30,
  metered: false,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
