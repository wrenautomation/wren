/** Headers our Worker sets on every call it forwards to the sign-in Lambda. */

/** The edge secret: proof the call came through us. */
export const EDGE_HEADER = "x-wren-edge";
/** The caller's address, for rate limits. */
export const IP_HEADER = "x-wren-ip";
/** Who the portal Worker checked is signed in, on a key it passes on (`KEY_VIEWER_HEADER` in `@wren/core/key-refs`). */
export const VIEWER_HEADER = "x-wren-viewer";
