/**
 * The fake server's answers, path → body (`../api.ts`), for every page story. Synthetic data only.
 * A story adds or swaps answers with `pageAt(at, { answers })`.
 */
import type { Row } from "@wren/core/records/serve";
import type { Answers } from "../api.js";
import { APP_ANSWERS } from "./apps.js";
import { JOURNEY_DETAIL, JOURNEY_ROWS, JOURNEY_WRITES } from "./journeys.js";
import { AUTO_REPLY, CADENCE, PIECES, STUDIO_WAITING } from "./marketing.js";
import { recordsAnswers } from "./records.js";
import { SHELL } from "./shell.js";

export const ANSWERS: Answers = {
  ...recordsAnswers(
    { "marketing.cadence": CADENCE as unknown as Row[], ...JOURNEY_ROWS },
    JOURNEY_DETAIL,
  ),
  ...SHELL,
  ...APP_ANSWERS,
  ...JOURNEY_WRITES,
  "console/call:Pieces.list": { pieces: PIECES },
  "console/call:ContentDesk.waiting": STUDIO_WAITING,
  "console/call:InboxDesk.autoReplies": AUTO_REPLY,
};
