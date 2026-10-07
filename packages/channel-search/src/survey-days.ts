/**
 * `survey_days` (`@wren/core/schema`): each site survey's answers per day, value and the
 * visitor's first-touch channel, from the lander's `answers` export (cookie yes only). A short
 * text answer counts under `text`; its words stay on the lander and are read live
 * (`./records.ts` surveyAnswerRecord). Re-read whole each pass and upserted, as `site_days`.
 */
import type { SiteAnswer, SiteHit } from "@wren/channel-email";
import type { SurveyKind } from "@wren/core/surveys";
import { firstChannels } from "./flag-days.js";

export interface SurveyDayRow {
  survey: string;
  day: string;
  value: string;
  channel: string;
  answers: number;
}

/** Day rows from every answer; one per visitor and survey (the first), as the lander allows. */
export function rollupAnswers(
  answers: readonly SiteAnswer[],
  hits: readonly SiteHit[],
  kinds: ReadonlyMap<string, SurveyKind>,
): SurveyDayRow[] {
  const touch = firstChannels(hits);
  const seen = new Set<string>();
  const rows = new Map<string, SurveyDayRow>();
  for (const a of [...answers].sort((x, y) => x.id - y.id)) {
    const kind = kinds.get(a.survey);
    if (!kind || seen.has(`${a.survey}|${a.visitor}`)) continue;
    seen.add(`${a.survey}|${a.visitor}`);
    const value = kind === "text" ? "text" : a.value.slice(0, 80);
    const channel = touch.get(a.visitor) ?? "direct";
    const day = a.ts.slice(0, 10);
    const key = `${a.survey}|${day}|${value}|${channel}`;
    const row = rows.get(key) ?? { survey: a.survey, day, value, channel, answers: 0 };
    row.answers++;
    rows.set(key, row);
  }
  return [...rows.values()];
}
