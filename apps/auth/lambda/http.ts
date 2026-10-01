/**
 * A Lambda function URL call as a web Request, and a web Response back.
 * Only calls through our Worker count: it signs each with the edge secret.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { EDGE_HEADER } from "../src/headers.js";

/** The function URL payload (format 2.0), the parts we read. */
export interface UrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface UrlResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies: string[];
  body: string;
  isBase64Encoded: true;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Did this call come through our Worker? No secret configured = no. */
export function fromEdge(event: UrlEvent, secret: string | undefined): boolean {
  const got = event.headers?.[EDGE_HEADER];
  return Boolean(secret && got && timingSafeEqual(digest(got), digest(secret)));
}

/** The call as the browser made it to `origin`, minus the edge secret. */
export function toRequest(event: UrlEvent, origin: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {}))
    if (v !== undefined && k !== EDGE_HEADER) headers.set(k, v);
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  const method = event.requestContext.http.method;
  const hasBody = event.body !== undefined && method !== "GET" && method !== "HEAD";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  return new Request(`${origin}${event.rawPath}${query}`, {
    method,
    headers,
    ...(hasBody
      ? { body: event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64") : event.body }
      : {}),
  });
}

export async function toResult(res: Response): Promise<UrlResult> {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (k !== "set-cookie") headers[k] = v;
  });
  return {
    statusCode: res.status,
    headers,
    cookies: res.headers.getSetCookie(),
    body: Buffer.from(await res.arrayBuffer()).toString("base64"),
    isBase64Encoded: true,
  };
}
