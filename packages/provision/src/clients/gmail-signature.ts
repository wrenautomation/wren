/** The Gmail send-as signature of one inbox, acting as that inbox (domain-wide delegation). */
import { authedJson, type HttpClient, type TokenSupplier } from "../http.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

export interface SignatureClient {
  /** Idempotent: "kept" when the signature already matches. */
  setSignature(email: string, html: string): Promise<"set" | "kept">;
}

export class GmailError extends Error {
  constructor(what: string, status: number, body: unknown) {
    const detail = (body as { error?: { message?: string } } | null)?.error?.message ?? "";
    super(`gmail ${what}: HTTP ${status} ${detail}`.trim());
    this.name = "GmailError";
  }
}

/** `tokenFor(user)` mints a supplier acting as that user with the settings scope. */
export function signatureClient(opts: {
  tokenFor: (user: string) => TokenSupplier;
  http: HttpClient;
}): SignatureClient {
  return {
    async setSignature(email, html) {
      const token = opts.tokenFor(email);
      const url = `${GMAIL}/settings/sendAs/${encodeURIComponent(email)}`;
      const current = await authedJson<{ signature?: string }>(opts.http, token, url);
      if (current.status >= 400) throw new GmailError("get sendAs", current.status, current.body);
      if ((current.body?.signature ?? "") === html) return "kept";
      const r = await authedJson(opts.http, token, url, {
        method: "PATCH",
        body: { signature: html },
      });
      if (r.status >= 400) throw new GmailError("set signature", r.status, r.body);
      return "set";
    },
  };
}
