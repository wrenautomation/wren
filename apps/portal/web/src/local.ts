/** What a viewer keeps in this browser (a remembered pick), never needed: a blocked store reads as nothing. */

/** The kept text under `key`, or null. */
export const recall = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Keep `value` under `key`. */
export const keep = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
