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
  /** Our app's host, e.g. app.wrenautomation.com. Set: any other host is a client's own (./hosts.ts). */
  APP_HOST?: string;
  /** The sign-in Lambda and the auth Worker's edge secret: a client's host redeems sign-ins there. */
  LAMBDA_URL?: string;
  EDGE_SECRET?: string;
  /** Turnstile on a client's booking page: both set, a booking must pass it. Unset = honeypot only. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /**
   * Dictation's speech server: an OpenAI-compatible `/audio/transcriptions` URL (./dictate.ts).
   * Unset = the server adapter is off and phones without WebGPU get no mic.
   */
  DICTATE_URL?: string;
  /** Its model name; default whisper-large-v3-turbo. */
  DICTATE_MODEL?: string;
  /** Its key, a secret, when it takes one. */
  DICTATE_KEY?: string;
}
