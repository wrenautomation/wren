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

/** Keys that would walk off the block onto every object in the process. */
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

export function pathOf(dotted: string): string[] {
  const path = dotted.split(".");
  if (path.some((p) => !p)) throw new Error(`bad path ${JSON.stringify(dotted)}`);
  if (path.some((p) => UNSAFE.has(p))) throw new Error(`bad key in ${JSON.stringify(dotted)}`);
  const [product] = path;
  if (!product || !Object.hasOwn(PRODUCTS, product))
    throw new Error(
      `unknown product ${JSON.stringify(product)}; known: ${Object.keys(PRODUCTS).join(", ")}`,
    );
  return path;
}

type Node = Json | unknown[];
const isIndex = (key: string) => /^\d+$/.test(key);

/** The child at `key`: an array element by index, an object's own key, else undefined. */
function child(node: unknown, key: string): unknown {
  if (Array.isArray(node)) return isIndex(key) ? node[Number(key)] : undefined;
  return isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
}

function put(node: Node, key: string, value: unknown, dotted: string) {
  if (Array.isArray(node)) {
    if (!isIndex(key) || Number(key) > node.length)
      throw new Error(`${dotted}: ${key} is not an index into a list of ${node.length}`);
    node[Number(key)] = value;
  } else node[key] = value;
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
    const dotted = path.join(".");
    let node: Node = next;
    for (const [i, key] of path.slice(0, -1).entries()) {
      let at = child(node, key);
      if (!isObject(at) && !Array.isArray(at)) {
        // A missing step becomes a list when the next key is an index, else an object.
        at = isIndex(path[i + 1] as string) ? [] : {};
        put(node, key, at, dotted);
      }
      node = at as Node;
    }
    put(node, path.at(-1) as string, value, dotted);
    touched.add(path[0] as string);
  }
  for (const path of unsets) {
    if (path.some((p) => UNSAFE.has(p))) throw new Error(`bad key in ${path.join(".")}`);
    let node: unknown = next;
    for (const key of path.slice(0, -1)) node = child(node, key);
    const last = path.at(-1) as string;
    // Nothing there is fine: an unset is idempotent.
    if (child(node, last) !== undefined) {
      if (Array.isArray(node)) node.splice(Number(last), 1);
      else delete (node as Json)[last];
    }
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
