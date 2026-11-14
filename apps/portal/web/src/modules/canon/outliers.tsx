/**
 * Canon › Outliers (designs/2026-11-12-eden-method.md §4, studio-suite D8): posts of tracked
 * creators that beat their own usual draw, as a gallery, best multiple first.
 */
import type { PageProps } from "../../module.js";
import { CreatorPosts, type PostsStart } from "./creator-posts.js";

const OUTLIERS: PostsStart = {
  layout: "gallery",
  sort: "multiple",
  all: false,
  first: "All outliers",
  label: "Outliers",
};

export function OutliersPage(p: PageProps) {
  return <CreatorPosts {...p} start={OUTLIERS} />;
}
