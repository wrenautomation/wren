/** The Worker's bindings. Secrets are set with `wrangler secret put`; see deploy/portal.md. */
export interface Env {
  ASSETS: Fetcher;
  /** The host that serves the demo: no sign-in, every answer masked. */
  DEMO_HOST: string;
  /** Restate Cloud ingress, e.g. https://<env>.env.<region>.restate.cloud:8080 */
  RESTATE_INGRESS_URL: string;
  RESTATE_AUTH_TOKEN?: string;
  /** Cloudflare Access: the team domain (`<team>.cloudflareaccess.com`) and the app's AUD tag. Unset = no sign-in yet. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Wren's own logins, comma separated: they see every client. */
  OPERATOR_EMAILS?: string;
}
