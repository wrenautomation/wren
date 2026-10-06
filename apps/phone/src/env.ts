/** The Worker's bindings. Secrets are set with `wrangler secret put`; see deploy/phone.md. */
export interface Env {
  ASSETS: Fetcher;
  /** Credential links: ciphertext only, each key lives 10 minutes (designs/2026-10-06-credential-links.md). */
  CRED_LINKS: KVNamespace;
  /** The secret autobrowse signs a new credential link with. Unset = minting refused. */
  CRED_LINK_SECRET?: string;
  /** Wren's sign-in, e.g. https://auth.wrenautomation.com: the token's issuer. Unset = the API is shut. */
  AUTH_ORIGIN?: string;
  /** Telnyx portal → Account → Public Key (base64). Unset = every webhook refused. */
  TELNYX_PUBLIC_KEY?: string;
  /** The secret Wren's cal.com webhook signs with. Unset = every booking webhook refused. */
  CALCOM_WEBHOOK_SECRET?: string;
  /** Each client's cal.com webhook secret, as JSON `{"<client>": "<secret>"}`. Unset = every client's refused. */
  CALCOM_WEBHOOK_SECRETS?: string;
  /** The token in the Pub/Sub push subscription's URL (`?token=`). Unset = Gmail's push refused. */
  GMAIL_PUSH_TOKEN?: string;
  /** Restate Cloud ingress, e.g. https://<env>.env.<region>.restate.cloud:8080 */
  RESTATE_INGRESS_URL: string;
  RESTATE_AUTH_TOKEN?: string;
}
