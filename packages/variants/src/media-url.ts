/** s3:// → a URL the browser can play; absent in local runs (media shows as missing). */
export type Sign = (uri: string) => Promise<string>;

/** A stored media uri as a link the browser opens; https:// (a live page) needs no signer. */
export const playableUrl =
  (sign: Sign | null) =>
  async (uri: string | null): Promise<string | null> =>
    !uri ? null : /^https:\/\//i.test(uri) ? uri : sign ? sign(uri).catch(() => null) : null;
