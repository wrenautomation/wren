/** Company news (S2): Google News RSS, Google page, Exa. Google 50 a day. Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const news = defineCollector({
  name: "news",
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
