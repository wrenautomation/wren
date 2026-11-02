/** A `fetch`-shaped function: the seam every HTTP client in this package takes for tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
