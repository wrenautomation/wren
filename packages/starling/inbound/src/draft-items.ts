/**
 * Inbound's draft item kind for the act base: `draft:<uuid>`, a post of ours on our own channel.
 * No default account (the channel's own) and no settle here: ContentDesk settles a post. The
 * whole desk's kinds (`{...reachKinds, ...contentKinds}`) are each app's to compose.
 */
import type { ItemKinds } from "@wren/starling-acts";
import { eq } from "drizzle-orm";
import { contentDrafts } from "./schema.js";

const UUID = /^[0-9a-f-]{36}$/i;

export const contentKinds: ItemKinds = {
  draft: {
    async place(db, id) {
      if (!UUID.test(id)) return null;
      const [d] = await db
        .select({ platform: contentDrafts.platform })
        .from(contentDrafts)
        .where(eq(contentDrafts.id, id));
      return d ? { platform: d.platform, sub: null } : null;
    },
    fallback: async () => null,
  },
};
