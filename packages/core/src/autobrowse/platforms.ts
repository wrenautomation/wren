/** The platforms autobrowse serves; no Restate here, so the portal web can import it. */
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
