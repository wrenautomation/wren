/** Demand posts (S8): reddit_threads, social_posts, Reddit search (20 a day). Stub: not built, so it never runs. */
import { z } from "zod";
import { defineCollector, ONCE } from "./index.js";

export const demand = defineCollector({
  name: "demand",
  subject: "post",
  built: false,
  settings: z.object({}),
  bucket: { perDay: 100, burst: 10 },
  everyDays: ONCE,
  metered: true,
  async collect() {
    return { state: "unresolved", signals: [], tried: [] };
  },
});
