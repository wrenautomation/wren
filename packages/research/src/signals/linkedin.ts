/** LinkedIn activity (S5): the activity page as linkedin@alt. Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const linkedin = defineCollector({
  name: "linkedin",
  subject: "person",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 10, burst: 2 },
  everyDays: 30,
  metered: true,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
