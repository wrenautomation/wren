/** Published posts as a console record for the Marketing app (`marketing_post_records`). */
import type { Platform } from "@wren/core/content";
import {
  date,
  defineRecord,
  link,
  number,
  rate,
  type State,
  status,
  text,
} from "@wren/core/records";

const NAMES: Record<Platform, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};
const PLATFORM_STATES: Record<string, State> = Object.fromEntries(
  Object.entries(NAMES).map(([p, label]) => [p, { label, tone: "neutral" }]),
);

export const postRecord = defineRecord({
  id: "marketing.post",
  name: { one: "post", many: "posts" },
  view: "marketing_post_records",
  key: "id",
  title: "title",
  subtitle: "platform",
  fields: {
    title: text("Post"),
    platform: status(PLATFORM_STATES),
    published: date(),
    views: number(),
    reactions: number(),
    comments: number(),
    shares: number(),
    engagement: rate("views", "Engagement", { from: "engaged" }),
    measured: date("Counted"),
    url: link("Link"),
    recent: status(
      {
        recent: { label: "Last 7 days", tone: "good" },
        earlier: { label: "Earlier", tone: "neutral" },
      },
      "When",
    ),
  },
  views: [
    { id: "all", label: "All", sort: "-published", at: "published" },
    {
      id: "week",
      label: "This week",
      where: { recent: "recent" },
      sort: "-published",
      at: "published",
    },
    { id: "top", label: "Top", sort: "-views", at: "published" },
    { id: "platform", label: "By platform", sort: "platform", at: "published" },
  ],
  actions: ["marketing.draftAgain"],
});

export const CONTENT_RECORDS = [postRecord];
