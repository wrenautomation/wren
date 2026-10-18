/**
 * The fake server's answers, path → body (`../api.ts`), for every page story. Synthetic data only.
 * A story adds or swaps answers with `pageAt(at, { answers })`.
 */
import type { Row } from "@wren/core/records/serve";
import type { Answers } from "../api.js";
import { APP_ANSWERS } from "./apps.js";
import { CADENCE, PIECES } from "./marketing.js";
import { recordsAnswers } from "./records.js";
import { SHELL } from "./shell.js";

export const ANSWERS: Answers = {
  ...recordsAnswers({ "marketing.cadence": CADENCE as unknown as Row[] }),
  ...SHELL,
  ...APP_ANSWERS,
  "console/call:Pieces.list": { pieces: PIECES },
};
