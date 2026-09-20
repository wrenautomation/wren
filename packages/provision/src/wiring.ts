/**
 * The real dependencies from settings and the environment. Secrets come from
 * the process env (the SSM env parameter on Lambda, llm.env locally), never
 * from argv or logs. Returns null, with the reason, when the domain
 * provisioner is not configured: the worker then simply does not bind it.
 *
 * Where the roster lives follows the host: on Lambda (AWS_LAMBDA_FUNCTION_NAME
 * set) it is the SSM parameter and a reload recycles the function; locally it
 * is the roster file and the operator restarts the worker.
 */
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import {
  loadServiceAccountKey,
  type ServiceAccountKey,
  serviceAccountToken,
} from "@wren/channel-email";
import { cloudflare } from "./clients/cloudflare.js";
import { GMAIL_SETTINGS_SCOPE, signatureClient } from "./clients/gmail-signature.js";
import { ADMIN_SCOPES, googleAdmin } from "./clients/google-admin.js";
import { domainAvailability } from "./clients/rdap.js";
import { fileRosterStore, lambdaReloader, restartByHand } from "./clients/reload.js";
import { type RosterStore, ssmRosterStore, ssmSecretStore } from "./clients/roster.js";
import { type HttpClient, httpClient } from "./http.js";
import type { DomainDeps } from "./restate/domain.js";

export interface BuildDepsOptions {
  /** The Workspace super admin the service account acts as. */
  adminUser: string;
  cloudflareAccountId: string;
  /** The roster: an SSM parameter name on Lambda, a file path elsewhere. */
  roster: { param: string } | { file: string };
  dmarcRua: string | null;
  /** Path of the service-account key (or its JSON inline). */
  serviceAccountKey: string | ServiceAccountKey;
  env: NodeJS.ProcessEnv;
  http?: HttpClient;
  ssm?: SSMClient;
  lambda?: LambdaClient;
}

/** Secret names read from the env. Named here so the deploy docs and this file agree. */
export const SECRET_ENV = { cloudflareToken: "CLOUDFLARE_API_TOKEN" } as const;

export function buildDeps(
  opts: BuildDepsOptions,
): { deps: DomainDeps; missing: null } | { deps: null; missing: string } {
  const cloudflareToken = opts.env[SECRET_ENV.cloudflareToken];
  if (!cloudflareToken) return { deps: null, missing: SECRET_ENV.cloudflareToken };
  const http = opts.http ?? httpClient();
  const key =
    typeof opts.serviceAccountKey === "string"
      ? loadServiceAccountKey(opts.serviceAccountKey)
      : opts.serviceAccountKey;
  const ssm = opts.ssm ?? new SSMClient({});
  const functionName = opts.env.AWS_LAMBDA_FUNCTION_NAME;
  const roster: RosterStore =
    "param" in opts.roster
      ? ssmRosterStore({ param: opts.roster.param, ssm })
      : fileRosterStore(opts.roster.file);
  const reloader = functionName
    ? lambdaReloader({ functionName, ...(opts.lambda ? { lambda: opts.lambda } : {}) })
    : restartByHand;
  return {
    missing: null,
    deps: {
      cloudflare: cloudflare({
        apiToken: cloudflareToken,
        accountId: opts.cloudflareAccountId,
        http,
      }),
      google: googleAdmin({
        token: serviceAccountToken(key, { scopes: ADMIN_SCOPES, subject: opts.adminUser }),
        http,
      }),
      signatures: signatureClient({
        tokenFor: (user) =>
          serviceAccountToken(key, { scopes: [GMAIL_SETTINGS_SCOPE], subject: user }),
        http,
      }),
      roster,
      secrets: ssmSecretStore({ ssm }),
      reloader,
      availability: (domain) => domainAvailability(http, domain),
      dmarcRua: opts.dmarcRua,
    },
  };
}
