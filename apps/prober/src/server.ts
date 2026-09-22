/**
 * The prober service: `POST /verify {email}` → the SmtpVerifier's verdict, from a host
 * that can open port 25 (the database box). Bearer-authenticated; one process, one
 * SmtpVerifier, so the per-MX gap holds across every caller. `GET /healthz` for the
 * box's own checks. Nothing here is a mailbox: no DATA, no delivery, ever.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { EmailVerifier } from "@wren/channel-email";
import { emailSyntaxError } from "@wren/core";

export interface ProberOptions {
  verifier: EmailVerifier;
  token: string;
  /** Calls at once across all MX hosts; the verifier still serialises per host. */
  maxInFlight?: number;
  log?: (line: string) => void;
}

const MAX_BODY = 4_096;

export function makeProber(opts: ProberOptions): Server {
  const maxInFlight = opts.maxInFlight ?? 8;
  const log = opts.log ?? (() => {});
  let inFlight = 0;
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz")
        return json(res, 200, { ok: true, in_flight: inFlight });
      if (req.method !== "POST" || req.url !== "/verify") return json(res, 404, { error: "no" });
      const offered = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!timingSafeEqual(offered, opts.token)) return json(res, 401, { error: "no" });
      if (inFlight >= maxInFlight) return json(res, 429, { error: "busy" });
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const syntax = email ? emailSyntaxError(email) : "missing email";
      if (syntax) return json(res, 400, { error: syntax });
      inFlight += 1;
      try {
        const t0 = Date.now();
        const verdict = await opts.verifier.verify(email);
        log(`${verdict.result} ${String(verdict.raw.reason ?? "")} ${Date.now() - t0}ms`);
        return json(res, 200, verdict);
      } finally {
        inFlight -= 1;
      }
    } catch (err) {
      log(`error ${err instanceof Error ? err.name : "Error"}`);
      return json(res, 500, { error: err instanceof Error ? err.name : "error" });
    }
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY) throw new Error("body too large");
  }
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Compare the whole string every time; no early exit on a wrong prefix. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || b.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
