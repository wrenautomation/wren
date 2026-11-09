/**
 * Pieces (designs/2026-10-13-primitives-first.md): each thing William made, once, with where it
 * went under it. `PieceList/wren` through the console. The Plan page's cards left with it (WA-1207).
 */

import type { Piece } from "@wren/starling-inbound/pieces";
import { call } from "../../api.js";
import { type Load, useCall } from "../../load.js";

const pieces = () =>
  call<{ pieces: Piece[] }>("console/call", {
    service: "PieceList",
    handler: "list",
    key: "wren",
    input: {},
  });
export const usePieces = (): Load<{ pieces: Piece[] }> => useCall("pieces", pieces);
