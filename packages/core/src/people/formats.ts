import { LINKEDIN_FORMAT } from "./linkedin.js";
import { OFFICERS_FORMAT } from "./officers.js";
import type { PersonSourceFormat } from "./sources.js";

/** People formats every niche can use. */
export const BUILTIN_PERSON_FORMATS: readonly PersonSourceFormat[] = [
  LINKEDIN_FORMAT,
  OFFICERS_FORMAT,
];
