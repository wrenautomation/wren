/**
 * A one-way call through Restate's ingress, for code already inside a `ctx.run` (a spine step),
 * where a journaled send would break replay. The idempotency key makes a retried run send once.
 */
export interface Ingress {
  url: string;
  headers?: Record<string, string>;
}

export async function ingressSend(
  ingress: Ingress,
  to: { service: string; key?: string; handler: string },
  idempotencyKey: string,
  body: unknown = null,
  /** Run it this long from now (Restate's delayed send); none or 0, at once. */
  delayMs = 0,
): Promise<void> {
  const path = [to.service, ...(to.key === undefined ? [] : [to.key]), to.handler]
    .map(encodeURIComponent)
    .join("/");
  const delay = delayMs > 0 ? `?delay=${Math.round(delayMs)}ms` : "";
  const res = await fetch(`${ingress.url.replace(/\/+$/, "")}/${path}/send${delay}`, {
    method: "POST",
    headers: {
      ...ingress.headers,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`ingress ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
