/** A sent link's preview through the Worker (src/unfurl.ts); a refusal (demo, dev, cap) = none. */
import { authHeaders } from "../../api.js";

export interface Unfurled {
  title?: string;
  line?: string;
  image?: string;
  icon?: string;
}

export async function unfurl(href: string): Promise<Unfurled> {
  const res = await fetch(`/api/unfurl?url=${encodeURIComponent(href)}`, {
    headers: await authHeaders(),
  });
  return res.ok ? ((await res.json()) as Unfurled) : {};
}
