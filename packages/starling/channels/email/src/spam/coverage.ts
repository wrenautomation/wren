/**
 * Every option of a template rendered at least once, in as few emails as the widest
 * variant point has options: render `i` takes option `i` at every point (or its last,
 * when a point has fewer). Rules fire on words, so every word gets scored without the
 * full product of combinations.
 */
import type { FactValues } from "@wren/core/slots";
import { type Rendered, render, type Template, variantPoints } from "@wren/core/slots";

export function coveringRenders(tpl: Template, facts: FactValues): Rendered[] {
  const points = [...variantPoints(tpl.subject ?? []), ...variantPoints(tpl.body)];
  const widest = Math.max(1, ...points.map((p) => p.options.length));
  return Array.from({ length: widest }, (_, i) => {
    // A one-hot share forces a hash pick; a rule picker that matches still wins, as in compose.
    const shares = Object.fromEntries(
      points.map((p) => {
        const pick = Math.min(i, p.options.length - 1);
        return [p.name, p.options.map((_, k) => (k === pick ? 1 : 0))];
      }),
    );
    return render(tpl, facts, `spamcheck:${i}`, { snapshot: 0, shares });
  });
}
