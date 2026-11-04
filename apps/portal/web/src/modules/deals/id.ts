/** The place the pipelines' pages live in (`../places.ts`). */
const PIPELINES = "people";

/** The address of a pipelines page: `pipelinesAt("calls", "view=booked")`. */
export const pipelinesAt = (page: string, search = "") =>
  `/${PIPELINES}/${page}${search ? `?${search}` : ""}`;
