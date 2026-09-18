/** Tiny DNS-over-HTTPS lookups (Cloudflare resolver). Used by domain setup audits and verification's MX checks. */

export const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
export type DnsType = "TXT" | "MX" | "A" | "AAAA";
const TYPE_CODES: Record<DnsType, number> = { TXT: 16, MX: 15, A: 1, AAAA: 28 };
// DNS RCODEs carried in the DNS-JSON `Status` field (RFC 1035 §4.1.1).
const NOERROR = 0;
const NXDOMAIN = 3;

/** The resolver could not be reached or answered non-2xx: resolver trouble, not evidence about the name. */
export class DohError extends Error {
  override name = "DohError";
}
/**
 * The resolver answered (HTTP 200) but the DNS status was neither NOERROR nor
 * NXDOMAIN (SERVFAIL, REFUSED) or the body wasn't DNS-JSON. Callers must not treat
 * it as a definitive empty answer.
 */
export class DohStatusError extends DohError {
  override name = "DohStatusError";
}

export type Resolver = (name: string, rtype: DnsType) => Promise<string[]>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function resolve(
  name: string,
  rtype: DnsType,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const url = `${DOH_ENDPOINT}?${new URLSearchParams({ name, type: rtype })}`;
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new DohError(
      `resolver unreachable for ${rtype} ${name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!resp.ok) throw new DohError(`HTTP ${resp.status} for ${rtype} ${name}`);
  let body: { Status?: number; Answer?: { type?: number; data?: string }[] };
  try {
    body = (await resp.json()) as typeof body;
  } catch {
    throw new DohStatusError(`non-JSON response for ${rtype} ${name}`);
  }
  if (body.Status === NXDOMAIN) return [];
  if (body.Status !== NOERROR)
    throw new DohStatusError(`DNS status ${body.Status} for ${rtype} ${name}`);
  return (body.Answer ?? [])
    .filter((a) => a.type === TYPE_CODES[rtype])
    .map((a) => a.data as string);
}
