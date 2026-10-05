import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import { keyScope } from "./enrichment.js";

const main = { name: "main" } as unknown as Db;
const acme = { name: "acme" } as unknown as Db;
const open = (c: string) => (c === "acme" ? acme : main);

describe("keyScope", () => {
  it("routes a key to its database and niche", () => {
    expect(keyScope("agencies", main, open)).toEqual({ db: main, niche: "agencies" });
    expect(keyScope("all@2/4", main, open)).toEqual({ db: main, niche: null });
    expect(keyScope("acme/all@1/2", main, open)).toEqual({ db: acme, niche: null });
    expect(keyScope("acme/dentists", main, open)).toEqual({ db: acme, niche: "dentists" });
  });

  it("refuses a client key where no client databases are wired", () => {
    expect(() => keyScope("acme/all", main)).toThrow(/no client databases/);
  });
});
