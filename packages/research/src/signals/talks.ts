/** Podcasts, talks (S6): iTunes Search, YouTube search (20 a day). Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector } from "./index.js";

export const talks = defineCollector({
  name: "talks",
  subject: "person",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 200, burst: 20 },
  everyDays: 90,
  metered: false,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
