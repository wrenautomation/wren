/** Job postings (S1): careers page, board API, LinkedIn jobs as linkedin@alt. Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const hiring = defineCollector({
  name: "hiring",
  subject: "company",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 150, burst: 20 },
  everyDays: 7,
  metered: false,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
