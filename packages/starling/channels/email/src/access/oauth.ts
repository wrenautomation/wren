/**
 * Wren's mail apps (designs/2026-10-07-mail-access.md). The sign-in wire (scopes, links, the
 * exchange, a refresh, Microsoft's admin consent and the consent check) is
 * `@wrenautomation/autobrowse/oauth`. What stays here is which apps Wren holds.
 */

/** One OAuth client: Wren's "Wren mail" app at Google or in Entra. */
export interface MailApp {
  id: string;
  secret: string;
}
export interface MailApps {
  google: MailApp | null;
  microsoft: MailApp | null;
}
