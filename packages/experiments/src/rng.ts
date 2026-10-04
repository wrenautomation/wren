/**
 * A seeded random source, so a run with the same seed gives the same numbers.
 * sfc32 keyed by sha256 of the seed: fast, and good enough for simulation.
 */
import { createHash } from "node:crypto";

export type Rng = () => number;

export function seeded(seed: string | number): Rng {
  const d = createHash("sha256").update(String(seed), "utf8").digest();
  let a = d.readUInt32LE(0);
  let b = d.readUInt32LE(4);
  let c = d.readUInt32LE(8);
  let n = d.readUInt32LE(12);
  return () => {
    const t = (((a + b) | 0) + n) | 0;
    n = (n + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function normal(rng: Rng): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Marsaglia and Tsang. */
function gamma(rng: Rng, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * (1 - rng()) ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = 1 - rng();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

export function betaDraw(rng: Rng, a: number, b: number): number {
  const x = gamma(rng, a);
  return x / (x + gamma(rng, b));
}
