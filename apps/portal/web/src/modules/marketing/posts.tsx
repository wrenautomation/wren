/** A post as its feed shows it on a laptop and a phone, from the record's detail. */
import { type MessageKind, MessagePreview, type RecordExtras } from "@wren/ui";
import { call } from "../../api.js";
import type { ListPage } from "../../module.js";

/** A channel's preview data (`@wren/content`, `@wren/channel-meta`): the whole text, the app, its cap and feed cut. */
type Post = {
  site: string;
  title: string | null;
  text: string;
  max?: number;
  feed: { laptop: number | null; phone: number | null };
};

const kindOf = (p: Post): MessageKind => ({
  kind: "post",
  site: p.site,
  from: "Wren Automation",
  title: p.title,
  ...(p.max ? { max: p.max } : {}),
  feed: p.feed,
});

export const postExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const post = (detail as { post?: Post | null } | null)?.post;
  return {
    sections: post
      ? [["How it looks", <MessagePreview key="looks" message={kindOf(post)} body={post.text} />]]
      : [],
  } satisfies RecordExtras;
};

/** The edit box's preview: the draft's platform, loaded when the box opens. */
export const draftPreview = (id: string | number) =>
  call<{ detail?: { post?: Post | null } }>("console/recordsGet", {
    record: "marketing.draft",
    id: String(id),
  }).then((r) => (r.detail?.post ? kindOf(r.detail.post) : null));
