/** The id of Wren's pipelines app (`deals` until 2026-10-19). In-portal links to its pages use it. */
const PIPELINES = "pipelines";

/** The address of a pipelines page: `pipelinesAt("calls", "view=booked")`. */
export const pipelinesAt = (page: string, search = "") =>
  `/${PIPELINES}/${page}${search ? `?${search}` : ""}`;
