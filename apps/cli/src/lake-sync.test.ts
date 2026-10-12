import { describe, expect, it } from "vitest";
import {
  keyFilter,
  lakeSchema,
  type PgTable,
  pgArray,
  SECRET_COLUMN,
  selectList,
} from "./lake-sync.js";

const t: PgTable = {
  schema: "public",
  name: "pairs",
  columns: [
    { name: "a", type: "integer" },
    { name: "b", type: "date" },
    { name: "body", type: "tsvector" },
    { name: "tags", type: "text[]" },
    { name: "webhook_secret", type: "text" },
  ],
  pk: ["a", "b"],
};

describe("lake sql", () => {
  it("names a lake schema per database and Postgres schema", () => {
    expect(lakeSchema(null, "public")).toBe("wren");
    expect(lakeSchema(null, "books")).toBe("wren_books");
    expect(lakeSchema("acme", "public")).toBe("client_acme");
  });

  it("leaves secrets out, reads odd types as text, adds the row hash", () => {
    expect(selectList(t)).toBe(
      '_r."a", _r."b", _r."body"::text AS "body", _r."tags", md5(_r::text) AS _h',
    );
    for (const c of ["secret", "prev_secret", "password", "token", "open_token", "access_token"])
      expect(SECRET_COLUMN.test(c)).toBe(true);
    for (const c of ["token_hash", "input_tokens", "token_ref", "secret_name"])
      expect(SECRET_COLUMN.test(c)).toBe(false);
  });

  it("quotes keys once for Postgres, once for DuckDB", () => {
    expect(pgArray(['a"b', "c\\d", "e'f"])).toBe('{"a\\"b","c\\\\d","e\'f"}');
    const one = { ...t, pk: ["a"] };
    expect(keyFilter(one, [["1", "2"]])).toBe(`_r."a" = ANY('{"1","2"}'::integer[])`);
    expect(keyFilter(t, [["1"], ["2026-10-01"]])).toBe(
      `(_r."a", _r."b") IN (SELECT * FROM unnest('{"1"}'::integer[], '{"2026-10-01"}'::date[]))`,
    );
    expect(keyFilter({ ...t, pk: null }, [["x'y"]])).toBe(
      `md5(_r::text) = ANY('{"x''y"}'::text[])`,
    );
  });
});
