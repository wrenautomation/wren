import { decodeHTML } from "entities";

/**
 * HTML character references to text, by the WHATWG table (every named entity,
 * out-of-range and surrogate numbers read as U+FFFD; never throws). A no-break
 * space reads as a plain one: every caller wants words, not layout.
 */
export const decodeHtml = (s: string): string =>
  s.includes("&") ? decodeHTML(s).replaceAll(" ", " ") : s;
