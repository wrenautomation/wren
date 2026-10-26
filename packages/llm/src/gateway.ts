/**
 * Gemini's own API through the LLM gateway, as a reader's `fetchFn` (scribe's `readYoutubeByUrl`
 * and `askGemini`): the gateway holds the keys and rotates them, so the caller passes any one
 * placeholder key. `gateway` is its base URL (`WREN_LLM_GATEWAY_URL`; the `/v1` OpenAI path is
 * dropped).
 */
export function gatewayGemini(gateway: string, token: string, fetchFn: typeof fetch = fetch) {
  const origin = new URL(gateway).origin;
  const google = "https://generativelanguage.googleapis.com/";
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(google)) return fetchFn(input, init);
    const headers = new Headers(init?.headers);
    headers.delete("x-goog-api-key");
    headers.set("authorization", `Bearer ${token}`);
    return fetchFn(`${origin}/${url.slice(google.length)}`, { ...init, headers });
  }) as typeof fetch;
}
