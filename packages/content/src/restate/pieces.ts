/**
 * `Pieces/wren` (designs/2026-10-13-primitives-first.md): Marketing's Today and Pieces read every
 * piece William made, each with its branches. Reads only; a yes goes through `marketing/approveDraft`.
 */
import * as restate from "@restatedev/restate-sdk";
import { NO_INPUT, sharedHandler } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { pieceRows, piecesOf } from "../pieces.js";

export const PIECES_KEY = "wren";

export interface PiecesDeps {
  db: Db;
  /** The site blog posts go up on. */
  site: string;
}

export function makePieces(deps: PiecesDeps) {
  return restate.object({
    name: "Pieces",
    handlers: {
      /** Every piece of the last 120 days, newest first. */
      list: sharedHandler({ input: NO_INPUT }, async (ctx: restate.ObjectSharedContext) => {
        if (ctx.key !== PIECES_KEY) throw new restate.TerminalError("pieces are Wren's own");
        const rows = await ctx.run("rows", () => pieceRows(deps.db, deps.site));
        return { pieces: piecesOf(rows) };
      }),
    },
  });
}
