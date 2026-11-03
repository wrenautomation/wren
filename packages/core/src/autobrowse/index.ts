/**
 * autobrowse's sites from here: the client, its errors and caps, and the platforms it serves.
 * The content channel port on top: `@wren/starling-core` (designs/2026-11-02-starling.md).
 */

export * from "./autobrowse.js";
export * from "./do.js";

export type Platform =
  | "linkedin"
  | "reddit"
  | "youtube"
  | "x"
  | "instagram"
  | "threads"
  | "facebook"
  | "tiktok"
  | "google_business";
export const PLATFORMS: readonly Platform[] = [
  "linkedin",
  "reddit",
  "youtube",
  "x",
  "instagram",
  "threads",
  "facebook",
  "tiktok",
  "google_business",
];
export type FetchedWith = "api" | "browser";
