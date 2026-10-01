/** Headers our Worker sets on every call it forwards to the sign-in Lambda. */

/** The edge secret: proof the call came through us. */
export const EDGE_HEADER = "x-wren-edge";
/** The caller's address, for rate limits. */
export const IP_HEADER = "x-wren-ip";
