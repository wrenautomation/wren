/**
 * The web's shape (designs/2026-11-05-research-web.md): dots at fixed positions. Zoom shows
 * detail by size alone: a dot grows as the camera nears, and its label shows once it is big enough.
 */

/** One dot: where it sits, how big, its color as a token name or a CSS color. */
export interface WebDot {
  id: string;
  x: number;
  y: number;
  size: number;
  label: string;
  /** A token ("--ui-accent") or any CSS color. */
  color: string;
  /** Drawn faint: a page only listed, never read. */
  faint?: boolean | undefined;
}

export interface WebLink {
  source: string;
  target: string;
}
