/** The Worker's bindings. Secrets are set with `wrangler secret put`; see deploy/phone.md. */
export interface Env {
  ASSETS: Fetcher;
  /** Passkeys: `cred:<id>` → the public key and counter. */
  CREDS: KVNamespace;
  /** Signs session and challenge cookies. */
  SESSION_SECRET: string;
  /** The one secret that may add a device (`/?setup=<token>`). */
  SETUP_TOKEN: string;
  /** Telnyx portal → Account → Public Key (base64). Unset = every webhook refused. */
  TELNYX_PUBLIC_KEY?: string;
  /** Restate Cloud ingress, e.g. https://<env>.env.<region>.restate.cloud:8080 */
  RESTATE_INGRESS_URL: string;
  RESTATE_AUTH_TOKEN?: string;
  /** Passkey relying party; defaults to the request's host. */
  RP_ID?: string;
}
