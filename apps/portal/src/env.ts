/** The Worker's bindings. Secrets are set with `wrangler secret put`; see deploy/portal.md. */
export interface Env {
  ASSETS: Fetcher;
  /** The host that serves the demo: no sign-in, every answer masked. */
  DEMO_HOST: string;
  /** Restate Cloud ingress, e.g. https://<env>.env.<region>.restate.cloud:8080 */
  RESTATE_INGRESS_URL: string;
  RESTATE_AUTH_TOKEN?: string;
  /** Our sign-in, e.g. https://auth.wrenautomation.com: it signs the tokens and publishes the keys. Unset = no sign-in yet. */
  AUTH_ORIGIN?: string;
}
