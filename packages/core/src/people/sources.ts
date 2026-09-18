/**
 * PersonSource: the seam every people-bearing source implements. Mirrors LeadSource
 * but yields TYPED rows: the dialect knowledge lives in the niche adapter.
 */
import type { PersonItem } from "./schema.js";

export interface PersonSource {
  sourceType: string;
  sourceRef: string;
  contentHash?: string;
  rows(): Iterable<PersonItem> | AsyncIterable<PersonItem>;
}

/** Registry entry: how to build a PersonSource from a path. Core ships none; niches register theirs. */
export interface PersonSourceFormat {
  name: string;
  help: string;
  build: (path: string) => PersonSource;
  /** Stamped onto companies the import creates. */
  niche: string | null;
}
