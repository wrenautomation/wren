/**
 * The source kit's logic, without a DOM: components are called as functions and the
 * elements they return are read. Tests that expose a bug assert the correct behavior and
 * are marked "Bug".
 */
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Cite,
  Cited,
  marksOf,
  SourceCard,
  SURE_LEVELS,
  Sure,
  type SureLevel,
  stripMarks,
  Trail,
} from "./sources.js";

type El = ReactElement<Record<string, unknown>>;
const el = (n: ReactNode): El => {
  if (!isValidElement(n)) throw new Error("not an element");
  return n as El;
};
const kids = (n: El): ReactNode[] => {
  const c = n.props.children as ReactNode;
  return Array.isArray(c) ? c.flat(Number.POSITIVE_INFINITY) : [c];
};
/** Every element under `n`, depth first, calling function components on the way. */
function all(n: ReactNode): El[] {
  if (!isValidElement(n)) return Array.isArray(n) ? n.flatMap(all) : [];
  const e = n as El;
  if (typeof e.type === "function")
    return [e, ...all((e.type as (p: unknown) => ReactNode)(e.props))];
  return [e, ...kids(e).flatMap(all)];
}

/** What Sure shows: bars filled and the words. */
const sure = (value: number, levels?: SureLevel[]) => {
  const e = el(Sure(levels ? { value, levels } : { value }));
  const label = kids(e).filter((c) => typeof c === "string");
  const bars = all(e).filter((x) => x.type === "i");
  return {
    level: e.props["data-level"],
    label: label.join(""),
    on: bars.filter((b) => b.props.className === "ui-sure-on").length,
  };
};

describe("Sure", () => {
  it("each level at and just under its edge", () => {
    expect(sure(1)).toEqual({ level: 4, label: "Sure", on: 4 });
    expect(sure(0.9)).toEqual({ level: 4, label: "Sure", on: 4 });
    expect(sure(0.8999)).toEqual({ level: 3, label: "Fairly sure", on: 3 });
    expect(sure(0.7)).toEqual({ level: 3, label: "Fairly sure", on: 3 });
    expect(sure(0.5)).toEqual({ level: 2, label: "Maybe", on: 2 });
    expect(sure(0.4999)).toEqual({ level: 1, label: "Unsure", on: 1 });
    expect(sure(0)).toEqual({ level: 1, label: "Unsure", on: 1 });
  });

  it("over 1 is as sure as it gets", () => {
    expect(sure(1.7)).toMatchObject({ label: "Sure", level: 4 });
  });

  it("bars grow short to tall, one per level", () => {
    const bars = all(Sure({ value: 0.5 })).filter((x) => x.type === "i");
    const heights = bars.map((b) =>
      Number.parseFloat(String((b.props.style as { height: string }).height)),
    );
    expect(heights).toHaveLength(SURE_LEVELS.length);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
  });

  it("no levels: no bars, no words, no crash", () => {
    expect(sure(0.5, [])).toEqual({ level: 0, label: "", on: 0 });
  });

  it("one level: its height is finite", () => {
    const bars = all(Sure({ value: 0.5, levels: [{ min: 0, label: "Some" }] })).filter(
      (x) => x.type === "i",
    );
    expect(bars.map((b) => (b.props.style as { height: string }).height)).toEqual(["4px"]);
  });

  // Bug: Sure (sources.tsx:70-74) falls back to the TOP level when no level's min is reached
  // (findIndex -1 becomes 0), so a reading under every level shows as fully sure.
  it("Bug: a reading under every level fills no bar and isn't called sure", () => {
    const levels = [
      { min: 0.9, label: "Sure" },
      { min: 0.5, label: "Maybe" },
    ];
    expect(sure(0.2, levels)).toMatchObject({ level: 0, on: 0 });
    expect(sure(0.2, levels).label).not.toBe("Sure");
  });

  it("Bug: a negative reading is not shown as Sure", () => {
    expect(sure(-0.1).label).not.toBe("Sure");
    expect(sure(-0.1).level).toBeLessThanOrEqual(1);
  });

  it("Bug: a reading that isn't a number is not shown as Sure", () => {
    expect(sure(Number.NaN).label).not.toBe("Sure");
    expect(sure(Number.NaN).level).toBeLessThanOrEqual(1);
  });
});

describe("SourceCard", () => {
  const card = (p: Parameters<typeof SourceCard>[0]) => all(SourceCard(p));

  it("a record (sure null or left out) shows no Sure; zero does", () => {
    const has = (s: number | null | undefined) =>
      card({ kind: "Your CRM", sure: s }).some((x) => x.type === Sure);
    expect(has(null)).toBe(false);
    expect(has(undefined)).toBe(false);
    expect(has(0)).toBe(true);
  });

  it("a null href shows the page without linking it", () => {
    const withLink = card({
      kind: "Job change",
      link: { href: "https://a.example", label: "a.example" },
    });
    expect(withLink.some((x) => x.type === "a" && x.props.href === "https://a.example")).toBe(true);
    const shown = card({ kind: "Job change", link: { href: null, label: "linkedin.com" } });
    expect(shown.some((x) => x.type === "a")).toBe(false);
    expect(shown.some((x) => x.type === "span" && kids(x).includes("linkedin.com"))).toBe(true);
  });

  it("no detail, no list", () => {
    expect(card({ kind: "Left", detail: [] }).some((x) => x.type === "dl")).toBe(false);
  });

  it("n 0 still shows its number", () => {
    expect(card({ kind: "Left", n: 0 }).some((x) => x.props.className === "ui-source-n")).toBe(
      true,
    );
  });

  // Bug: detail rows are keyed by label (sources.tsx:149), but a card can repeat a label: the
  // portal gives a hiring source one "Role" row per open role. Repeated keys make React drop or
  // mix up rows when the card updates.
  it("Bug: detail rows with the same label get distinct keys", () => {
    const rows = card({
      kind: "Hiring",
      detail: [
        ["Open roles", "3"],
        ["Role", "Recruiter, Toronto"],
        ["Role", "Sourcer, Remote"],
      ],
    }).filter((x) => x.type === "div" && kids(x).some((k) => isValidElement(k) && k.type === "dt"));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });
});

describe("Cite and Trail", () => {
  it("a chip without href or label points at its number", () => {
    const a = el(Cite({ n: 3 }));
    expect(a.props.href).toBe("#source-3");
    expect(a.props["aria-label"]).toBe("Source 3");
  });

  it("a click without onPick follows the link", () => {
    const a = el(Cite({ n: 1 }));
    let prevented = false;
    (a.props.onClick as (e: { preventDefault: () => void }) => void)({
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false);
  });

  it("a click with onPick picks instead of jumping", () => {
    let picked = 0;
    let prevented = false;
    const a = el(Cite({ n: 1, onPick: () => (picked += 1) }));
    (a.props.onClick as (e: { preventDefault: () => void }) => void)({
      preventDefault: () => {
        prevented = true;
      },
    });
    expect({ picked, prevented }).toEqual({ picked: 1, prevented: true });
  });

  it("a trail keeps its steps in order", () => {
    const steps = all(
      Trail({
        steps: [
          { id: "line", label: "In the email", children: "a" },
          { id: "brief", label: "Brief", children: "b" },
        ],
      }),
    ).filter((x) => x.type === "li");
    expect(steps.map((s) => s.key)).toEqual(["line", "brief"]);
  });
});

describe("marksOf", () => {
  it("reads every mark, lowercase, in order", () => {
    expect(marksOf("A. [f1] B. [ F2 ; c3 ] C. [f4,c5][c6]")).toEqual([
      "f1",
      "f2",
      "c3",
      "f4",
      "c5",
      "c6",
    ]);
  });

  it("a bracket that isn't all marks cites nothing", () => {
    for (const s of ["[f1, x2]", "[f1,]", "[f 1]", "[1]", "(f1)", "f1", "[]", "[f]", "[f1.5]"])
      expect(marksOf(s), s).toEqual([]);
  });

  it("is the same twice: the regex keeps no state between calls", () => {
    const s = "One. [f1] Two. [c2]";
    expect(marksOf(s)).toEqual(marksOf(s));
    expect(marksOf(s)).toEqual(["f1", "c2"]);
  });
});

describe("stripMarks", () => {
  it("drops marks and the space they leave before a period, comma or semicolon", () => {
    expect(stripMarks("Moved to Initech [f1]. Still hiring [f2, c3], and more [c4];")).toBe(
      "Moved to Initech. Still hiring, and more;",
    );
  });

  // Bug: stripMarks closes the gap only before . , ; so a mark before ? or !
  // leaves "there ?". The server's stripMarks (compose.ts:370-374) handles . , ; ! ?.
  it("Bug: a mark before ? or ! leaves no gap", () => {
    expect(stripMarks("Still there [f1]? Hiring [f2]!")).toBe("Still there? Hiring!");
  });
});

describe("Cited", () => {
  type El = ReactElement<Record<string, unknown>>;
  const chips = (text: string, order: string[]) => {
    const out = (Cited({ text, order, onPick: () => {} }) as El).props.children as ReactNode[];
    return out
      .filter((n): n is El => isValidElement(n))
      .map((span) =>
        (span.props.children as ReactNode[]).filter((c): c is El => isValidElement(c)),
      );
  };
  const html = (text: string, order: string[], lit?: string) =>
    renderToStaticMarkup(createElement(Cited, { text, order, lit, onPick: () => {} }));

  it("a chip's number is its mark's place in the order; case doesn't matter", () => {
    const got = chips("A. [F2] B. [c3, f1]", ["c3", "f1", "f2"]);
    expect(got.map((s) => s.map((c) => c.props.n))).toEqual([[3], [1, 2]]);
    expect(got.flat().map((c) => c.props.href)).toEqual(["#src-f2", "#src-c3", "#src-f1"]);
  });

  it("an unknown mark shows no chip and no mark", () => {
    const out = html("A. [f9] B. [f1, f9]", ["f1"]);
    expect(out).not.toMatch(/f9|\[|\]/);
    expect(out.match(/class="ui-cite/g)).toHaveLength(1);
  });

  it("the words around the marks stay whole, in order", () => {
    const text = "Cara moved. [f1] Umbrella is hiring. [f2] Worth a note.";
    expect(html(text, ["f1", "f2"]).replace(/<[^>]+>/g, "")).toBe(
      "Cara moved.1 Umbrella is hiring.2 Worth a note.",
    );
    expect(html("No marks here.", [])).toBe("No marks here.");
    expect(html("", [])).toBe("");
  });

  it("the lit mark's chip is on, the others aren't", () => {
    const got = chips("[f1, f2]", ["f1", "f2"]).flat();
    expect(got.map((c) => c.props.on)).toEqual([false, false]);
    const out = html("[f1, f2]", ["f1", "f2"], "f2");
    expect(out.match(/ui-cite-on/g)).toHaveLength(1);
  });

  it("a pick names the mark, lowercase", () => {
    const picked: string[] = [];
    const out = (Cited({ text: "[F1]", order: ["f1"], onPick: (m) => picked.push(m) }) as El).props
      .children as ReactNode[];
    const span = out.find((n): n is El => isValidElement(n));
    if (!span) throw new Error("no chips");
    const [chip] = (span.props.children as ReactNode[]).filter((c): c is El => isValidElement(c));
    if (!chip) throw new Error("no chip");
    (chip.props.onPick as () => void)();
    expect(picked).toEqual(["f1"]);
  });

  // Bug: Cited makes one chip per id in the bracket, keyed by id, so a mark
  // cited twice in one bracket ("[f1, F1]") shows the same number twice with a repeated key.
  it("Bug: a mark repeated in one bracket shows one chip", () => {
    const [span] = chips("Moved. [f1, F1]", ["f1"]);
    expect(span).toHaveLength(1);
  });
});
