import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { columnsOf } from "./records.js";
import {
  cellsOf,
  DataTable,
  FactsTable,
  type ListTable,
  sortingOf,
  useLines,
  useListTable,
  VIRTUAL_FROM,
} from "./table.js";

const field = (key: string, kind: FieldMeta["kind"] = "text"): FieldMeta => ({
  key,
  kind,
  label: key,
  ops: [],
  sortable: true,
  searchable: false,
  column: { align: "start", width: "m", max: 280 },
});
const name = field("name");
const state = field("state", "status");
const city = field("city");
const meta = {
  id: "test.thing",
  app: "test",
  channel: null,
  name: { one: "thing", many: "things" },
  title: "name",
  subtitle: null,
  fields: [name, state, city],
  views: [],
  related: [],
  actions: [],
  activity: false,
  detail: true,
} satisfies RecordMeta;
const rows: Row[] = [
  { id: 1, name: "Alpha", state: "open", city: "Springfield" },
  { id: 2, name: "Beta", state: "done", city: "Shelbyville" },
  { id: 3, name: "Gamma", state: "open", city: "Ogdenville" },
  { id: 4, name: "Delta", state: "done", city: "Capital City" },
];

type Ask = Partial<Parameters<typeof useListTable>[0]>;

/** The table a list would draw, read once through a server render. */
function tableOf(ask: Ask = {}): ListTable {
  let got: ListTable | null = null;
  function Probe() {
    got = useListTable({
      meta,
      rows,
      cols: [name, state, city],
      sort: undefined,
      group: null,
      split: -1,
      picked: new Set(),
      onPicked: () => {},
      ...ask,
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!got) throw new Error("no table");
  return got;
}

describe("sortingOf", () => {
  it("reads the address's sort as the table's", () => {
    expect(sortingOf(undefined)).toEqual([]);
    expect(sortingOf("at")).toEqual([{ id: "at", desc: false }]);
    expect(sortingOf("-at")).toEqual([{ id: "at", desc: true }]);
  });
});

describe("useListTable", () => {
  it("draws every row in the server's order with no group", () => {
    const t = tableOf();
    expect(t.lines.map((l) => l.key)).toEqual(["1", "2", "3", "4"]);
    expect(t.rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it("puts the columns in the order given and hides the rest", () => {
    const t = tableOf({ cols: [name, city] });
    expect(t.cols.map((f) => f.key)).toEqual(["name", "city"]);
    const back = tableOf({ cols: [name, city, state] });
    expect(back.cols.map((f) => f.key)).toEqual(["name", "city", "state"]);
  });

  it("groups by a field under a band each, in first-seen order", () => {
    const t = tableOf({ group: state });
    expect(t.lines.map((l) => (l.kind === "group" ? `[${l.value} ${l.n}]` : l.key))).toEqual([
      "[open 2]",
      "1",
      "3",
      "[done 2]",
      "2",
      "4",
    ]);
    // Rows walk in the order they draw.
    expect(t.rows.map((r) => r.id)).toEqual([1, 3, 2, 4]);
    const row = t.lines.find((l) => l.kind === "row" && l.key === "2");
    expect(row?.kind === "row" && row.index).toBe(2);
  });

  it("splits what waits on the viewer from what is for info", () => {
    const t = tableOf({ split: 1 });
    expect(t.lines.map((l) => (l.kind === "tier" ? `[${l.needs} ${l.n}]` : l.key))).toEqual([
      "[true 1]",
      "1",
      "[false 3]",
      "2",
      "3",
      "4",
    ]);
  });

  it("says which column sorts and which way", () => {
    const t = tableOf({ sort: "-city" });
    expect(t.sorted("city")).toBe("desc");
    expect(t.sorted("name")).toBe(false);
    expect(tableOf({ sort: "name" }).sorted("name")).toBe("asc");
  });

  it("keeps which rows are picked", () => {
    const some = tableOf({ picked: new Set(["2"]) });
    expect([some.all, some.some, some.picked("2"), some.picked("1")]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    const all = tableOf({ picked: new Set(["1", "2", "3", "4"]) });
    expect(all.all).toBe(true);
    let next: Set<string> | null = null;
    tableOf({ picked: new Set(["2"]), onPicked: (s) => (next = s) }).toggle("3");
    expect([...(next ?? [])].sort()).toEqual(["2", "3"]);
  });
});

describe("columnsOf", () => {
  it("follows the address's column order, the title first", () => {
    const keys = (q: string) => columnsOf(meta, new URLSearchParams(q)).map((f) => f.key);
    expect(keys("")).toEqual(["name", "state", "city"]);
    expect(keys("cols=city,state")).toEqual(["name", "city", "state"]);
    expect(keys("cols=none")).toEqual(["name"]);
  });
});

describe("useLines", () => {
  it("draws every line under the threshold", () => {
    let got: number[] = [];
    function Probe({ count }: { count: number }) {
      const l = useLines({ count, scroller: null, root: () => null, estimate: 40 });
      got = l.on ? [-1] : l.shown;
      return null;
    }
    renderToStaticMarkup(<Probe count={3} />);
    expect(got).toEqual([0, 1, 2]);
    renderToStaticMarkup(<Probe count={VIRTUAL_FROM + 1} />);
    expect(got).toEqual([-1]);
  });
});

describe("DataTable", () => {
  it("draws heads and cells, numbers at the end", () => {
    const html = renderToStaticMarkup(
      <DataTable
        data={[{ v: "v1", n: 12 }]}
        columns={[
          { key: "v", label: "Version", cell: (r) => r.v },
          { key: "n", label: "Sent", end: true, cell: (r) => r.n },
        ]}
      />,
    );
    expect(html).toContain("<th");
    expect(html).toContain("Version");
    expect(html).toMatch(/text-right tabular-nums[^>]*>12</);
  });

  it("stacks each row as a card on a phone when asked", () => {
    const html = renderToStaticMarkup(
      <FactsTable stack head={["Source", ["Visits", "r"]]} rows={[["Mail", "4"]]} />,
    );
    expect(html).toContain("sm:hidden");
    expect(html).toContain("<dt");
  });

  it("lets a stacked value break, so an unbroken email stays in its column", () => {
    const html = renderToStaticMarkup(
      <FactsTable
        stack
        head={["Source", "Mail"]}
        rows={[["https://example.com/averylongunbrokenpath", "averyverylongmailbox@example.com"]]}
      />,
    );
    expect(html).toMatch(/<dd class="\[overflow-wrap:anywhere\][^"]*">averyverylongmailbox/);
    expect(html).toContain("grid min-w-0 gap-0.5");
    expect(html).toMatch(/<div class="\[overflow-wrap:anywhere\]">https:/);
  });

  it("reads positional heads", () => {
    const { columns } = cellsOf(["Source", ["Visits", "r"]], []);
    expect(columns.map((c) => [c.label, !!c.end])).toEqual([
      ["Source", false],
      ["Visits", true],
    ]);
  });
});
