/** A sent link's preview through the Worker (src/unfurl.ts); a refusal (demo, dev, cap) = none. */
import type { LinkPreview } from "@wren/ui";
import { authHeaders } from "../../api.js";

export async function unfurl(href: string): Promise<LinkPreview> {
  const res = await fetch(`/api/unfurl?url=${encodeURIComponent(href)}`, {
    headers: await authHeaders(),
  });
  return res.ok ? ((await res.json()) as LinkPreview) : {};
}
