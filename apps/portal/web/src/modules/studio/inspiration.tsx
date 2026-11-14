/**
 * Studio › Inspiration (studio-suite D8): every post of his tracked creators as a feed, newest
 * first; 10x and up wear the accent wash.
 */

import type { PageProps } from "../../module.js";
import { CreatorPosts, type PostsStart } from "../canon/creator-posts.js";

const INSPIRATION: PostsStart = {
  layout: "feed",
  sort: "new",
  all: true,
  first: "All posts",
  label: "Inspiration",
};

export function InspirationPage(p: PageProps) {
  return <CreatorPosts {...p} start={INSPIRATION} />;
}
