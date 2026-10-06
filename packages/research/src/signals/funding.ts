/** Funding (S3): SEC EDGAR Form D, kept as news with event funding. Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const funding = defineCollector({
  name: "funding",
  subject: "company",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 300, burst: 20 },
  everyDays: 90,
  metered: false,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
