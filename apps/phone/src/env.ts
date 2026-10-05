/** The Worker's bindings. Secrets are set with `wrangler secret put`; see deploy/phone.md. */
export interface Env {
  ASSETS: Fetcher;
  /** Wren's sign-in, e.g. https://auth.wrenautomation.com: the token's issuer. Unset = the API is shut. */
  AUTH_ORIGIN?: string;
  /** Telnyx portal → Account → Public Key (base64). Unset = every webhook refused. */
  TELNYX_PUBLIC_KEY?: string;
  /** The secret Wren's cal.com webhook signs with. Unset = every booking webhook refused. */
  CALCOM_WEBHOOK_SECRET?: string;
  /** Each client's cal.com webhook secret, as JSON `{"<client>": "<secret>"}`. Unset = every client's refused. */
  CALCOM_WEBHOOK_SECRETS?: string;
  /** Restate Cloud ingress, e.g. https://<env>.env.<region>.restate.cloud:8080 */
  RESTATE_INGRESS_URL: string;
  RESTATE_AUTH_TOKEN?: string;
}
