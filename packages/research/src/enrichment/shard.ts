/**
 * Splitting a long loop across processes: `i/n` keeps the units whose id % n == i.
 * A shard is an ordinary run (same selection, same per-unit checkpoint), so n shards
 * in parallel are n independent durable runs over disjoint sets. Politeness holds:
 * one host belongs to one company, hence to exactly one shard.
 */
import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export class Shard {
  private constructor(
    readonly index: number,
    readonly count: number,
  ) {}

  /** "i/n" with 0 <= i < n. */
  static parse(text: string): Shard {
    const m = /^(-?\d+)\/(-?\d+)$/.exec(text.trim());
    if (!m) throw new Error(`shard must look like i/n, got '${text}'`);
    const index = Number.parseInt(m[1] as string, 10);
    const count = Number.parseInt(m[2] as string, 10);
    if (count < 1 || index < 0 || index >= count)
      throw new Error(`shard index must satisfy 0 <= i < n, got '${text}'`);
    return new Shard(index, count);
  }

  static of(index: number, count: number): Shard {
    return Shard.parse(`${index}/${count}`);
  }

  where(idColumn: PgColumn): SQL {
    return sql`${idColumn} % ${this.count} = ${this.index}`;
  }

  toString(): string {
    return `${this.index}/${this.count}`;
  }
}
