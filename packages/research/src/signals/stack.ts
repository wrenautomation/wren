/** Tech stack (S4): stored pages, DNS. Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const stack = defineCollector({
  name: "stack",
  subject: "company",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 1000, burst: 20 },
  everyDays: 30,
  metered: false,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
