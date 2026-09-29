/**
 * Loop keys. Wren's own name a mailbox or a unit ("fleet"); a client's are
 * `<client>/<unit>`. Client ids never hold a slash, so Wren's keys stay as they are.
 */
export const clientKey = (client: string, unit: string): string => `${client}/${unit}`;

/** The client a loop key belongs to, or null for Wren's own. */
export function clientOfKey(key: string): { client: string; unit: string } | null {
  const at = key.indexOf("/");
  return at > 0 ? { client: key.slice(0, at), unit: key.slice(at + 1) } : null;
}

/** The unit a key names, whoever owns it: `a@x.com` for `a@x.com` and `acme/a@x.com`. */
export const unitOfKey = (key: string): string => clientOfKey(key)?.unit ?? key;
