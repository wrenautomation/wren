/**
 * The products a client's `products` blocks belong to, each with its own
 * parser. The registry stores blocks opaque; the CLI checks one here before
 * it is written, so a typo fails at `clients set`, not in the worker.
 */
import { parseReactivationSettings } from "@wren/reactivation";

export const PRODUCTS: Record<string, (block: unknown) => unknown> = {
  reactivation: parseReactivationSettings,
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "a.b.c=value": the value as JSON when it parses, else the string. */
export function parseAssignment(pair: string): { path: string[]; value: unknown } {
  const at = pair.indexOf("=");
  if (at <= 0) throw new Error(`--set expects product.path=value, got ${JSON.stringify(pair)}`);
  const raw = pair.slice(at + 1);
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {}
  return { path: pathOf(pair.slice(0, at)), value };
}

export function pathOf(dotted: string): string[] {
  const path = dotted.split(".");
  if (path.some((p) => !p)) throw new Error(`bad path ${JSON.stringify(dotted)}`);
  const [product] = path;
  if (!product || !PRODUCTS[product])
    throw new Error(
      `unknown product ${JSON.stringify(product)}; known: ${Object.keys(PRODUCTS).join(", ")}`,
    );
  return path;
}

/**
 * Apply `--set` and `--unset` to a client's blocks. Returns only the products
 * touched: each whole block (checked by its parser) or null when it emptied.
 */
export function changeProducts(
  current: Record<string, unknown>,
  sets: { path: string[]; value: unknown }[],
  unsets: string[][],
): Record<string, unknown> {
  const next: Json = structuredClone(current);
  const touched = new Set<string>();
  for (const { path, value } of sets) {
    let node = next;
    for (const key of path.slice(0, -1)) {
      if (!isObject(node[key])) node[key] = {};
      node = node[key] as Json;
    }
    node[path.at(-1) as string] = value;
    touched.add(path[0] as string);
  }
  for (const path of unsets) {
    let node: unknown = next;
    for (const key of path.slice(0, -1)) node = isObject(node) ? node[key] : undefined;
    if (isObject(node)) delete node[path.at(-1) as string];
    touched.add(path[0] as string);
  }
  const out: Json = {};
  for (const product of touched) {
    const block = next[product];
    if (block === undefined || (isObject(block) && Object.keys(block).length === 0)) {
      out[product] = null;
      continue;
    }
    (PRODUCTS[product] as (b: unknown) => unknown)(block);
    out[product] = block;
  }
  return out;
}
