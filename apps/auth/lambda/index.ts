/**
 * Wren's sign-in, on Lambda (designs/2026-09-30-client-delivery-portal.md, A5).
 * The auth Worker forwards `/api/auth/*` here with the edge secret; anything
 * else is refused before it reaches the database. Cold start: secrets from
 * SSM, then Better Auth over the main database. Mail goes out through Gmail
 * as portal@ (a send-as alias on the operator mailbox).
 */
import { makeAuth } from "@wren/auth";
// The narrow modules: the send index pulls in the whole outbox tick and Restate.
import { GmailClient, plainMailer } from "@wren/channel-email/send/gmail";
import { GMAIL_SEND_SCOPE, loadServiceAccountKey } from "@wren/channel-email/send/google-auth";
import { loadSsmEnv } from "@wren/config/ssm";
import { isOperator, mayHandOff, mayHaveAccount } from "@wren/core/clients";
import { cachedDb } from "@wren/db";
import { IP_HEADER } from "../src/headers.js";
import { fromEdge, toRequest, toResult, type UrlEvent, type UrlResult } from "./http.js";

await loadSsmEnv(process.env.WREN_SSM_ENV_PARAM);

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const pair = (prefix: string) => {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
};

const ORIGIN = need("WREN_AUTH_ORIGIN");
const MAILBOX = need("WREN_AUTH_MAILBOX");
const FROM = need("WREN_AUTH_FROM");
const EDGE = need("WREN_AUTH_EDGE_SECRET");

const db = cachedDb(need("WREN_DATABASE_URL"), { app: "wren-auth" });
const gmail = new GmailClient({
  key: loadServiceAccountKey(need("WREN_GOOGLE_SERVICE_ACCOUNT")),
  scopes: [GMAIL_SEND_SCOPE],
});
const google = pair("WREN_AUTH_GOOGLE");
const microsoft = pair("WREN_AUTH_MICROSOFT");

const auth = makeAuth({
  db,
  secret: need("WREN_AUTH_SECRET"),
  baseURL: ORIGIN,
  trustedOrigins: (process.env.WREN_AUTH_APPS ?? "").split(",").filter(Boolean),
  ...(google ? { google } : {}),
  ...(microsoft ? { microsoft } : {}),
  allowed: (email) => mayHaveAccount(db, email),
  claims: async (email) => ({ operator: await isOperator(db, email) }),
  send: plainMailer(gmail, { mailbox: MAILBOX, from: FROM, name: "Wren" }),
  ipHeader: IP_HEADER,
  // Sign-in carried to a client's own host (designs/2026-10-06-custom-domains.md).
  handoff: (host, email) => mayHandOff(db, host, email),
  portal: process.env.WREN_PORTAL_ORIGIN ?? "https://app.wrenautomation.com",
});

export async function handler(
  event: UrlEvent,
): Promise<UrlResult | { statusCode: 403; body: string }> {
  if (!fromEdge(event, EDGE)) return { statusCode: 403, body: "forbidden" };
  return toResult(await auth.handler(toRequest(event, ORIGIN)));
}
