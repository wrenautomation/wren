import { WREN } from "../../module.js";

/** The body's client: none in Wren's workspace, whose journeys the server keeps as Wren's. */
export const atOf = (client: string): Record<string, string> =>
  client === WREN.id ? {} : { client };
