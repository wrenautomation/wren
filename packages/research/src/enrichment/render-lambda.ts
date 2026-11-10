/** The render tier for hosts with no chromium (Lambda): the render Lambda in `@wren/browser`. */
import { type RenderLambda, renderLambda } from "@wren/browser";
import type { BrowserRenderer } from "./render.js";
import { RenderUnavailable } from "./render.js";

/** One chromium per URL in the render Lambda; nothing held open. */
export function lambdaRenderer(
  userAgent: string,
  opts: { fn: string; lambda?: RenderLambda },
): BrowserRenderer {
  const lambda = opts.lambda ?? renderLambda(opts.fn);
  return {
    render: async (url) => {
      try {
        return await lambda.read(url, userAgent);
      } catch (err) {
        throw new RenderUnavailable(`render Lambda: ${(err as Error).message}`, { cause: err });
      }
    },
    close: async () => {},
  };
}
