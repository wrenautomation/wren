-- Leftovers with no writer (map/CONTEXT.md, 2026-09-28): the old LinkedIn post
-- pipeline and llm_calls. Empty on prod. One statement drops their mutual FKs
-- together; no CASCADE, so anything outside the set that depends on them fails loudly.
DROP TABLE "post_metrics", "posts", "post_ideas", "notes", "competitor_posts", "competitors", "research_runs", "llm_calls";
