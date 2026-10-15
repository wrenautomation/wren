import { describe, expect, it } from "vitest";
import { cardIdIn, fileLinkOf, guessMap, mapRows, parseTable, toCsv } from "./sheet.js";

describe("parseTable", () => {
  it("reads quoted cells, doubled quotes and line breaks inside quotes", () => {
    const t = parseTable('title,column\r\n"Order, the sign",Doing\r\n"Say ""hi""\nnow",To do\r\n');
    expect(t).toEqual([
      ["title", "column"],
      ["Order, the sign", "Doing"],
      ['Say "hi"\nnow', "To do"],
    ]);
  });
  it("reads a table pasted from a sheet (tabs)", () => {
    expect(parseTable("Task\tStatus\nCall Sam\tDoing\n\nSend quote\tDone")).toEqual([
      ["Task", "Status"],
      ["Call Sam", "Doing"],
      ["Send quote", "Done"],
    ]);
  });
});

describe("toCsv", () => {
  it("round-trips, and keeps formulas as text", () => {
    const rows = [
      ["title", "owner"],
      ['a, "b"', "ada@example.test"],
      ["=SUM(A1)", ""],
    ];
    const text = toCsv(rows);
    expect(text).toContain("'=SUM(A1)");
    const back = parseTable(text);
    expect(back[1]).toEqual(['a, "b"', "ada@example.test"]);
    expect(mapRows(back, ["title", "owner"])[1]).toEqual({ title: "=SUM(A1)" });
  });
});

describe("guessMap and mapRows", () => {
  it("matches the usual headers once each", () => {
    expect(guessMap(["Task", "Status", "Assignee", "Due date", "Notes", "Name"])).toEqual([
      "title",
      "column",
      "owner",
      "due",
      null,
      null,
    ]);
  });
  it("reads a labels column, however it is headed", () => {
    expect(guessMap(["Task", "Tags", "Due"])).toEqual(["title", "labels", "due"]);
    expect(
      mapRows(
        [
          ["Task", "Labels"],
          ["Call Sam", "sales; q4"],
        ],
        ["title", "labels"],
      ),
    ).toEqual([{ title: "Call Sam", labels: "sales; q4" }]);
  });
  it("leaves empty cells out", () => {
    expect(
      mapRows(
        [
          ["Task", "Owner"],
          ["Call Sam", ""],
        ],
        ["title", "owner"],
      ),
    ).toEqual([{ title: "Call Sam" }]);
  });
});

describe("links", () => {
  it("finds a card id in a link", () => {
    const id = "0b9f1c52-5d4e-4a52-9a1e-3c2f6a7d8e90";
    expect(cardIdIn(`https://app.example.test/notes/doc/${id}`)).toBe(id);
    expect(cardIdIn("https://example.test")).toBeNull();
  });
  it("names the file links it knows", () => {
    expect(fileLinkOf("https://docs.google.com/spreadsheets/d/abc/edit")?.kind).toBe("sheet");
    expect(fileLinkOf("https://docs.google.com/document/d/abc/edit")?.kind).toBe("doc");
    expect(fileLinkOf("https://www.dropbox.com/s/abc/x.pdf")?.kind).toBe("dropbox");
    expect(fileLinkOf("https://1drv.ms/x/abc")?.kind).toBe("onedrive");
    expect(fileLinkOf("https://example.test/x")).toBeNull();
  });
});
