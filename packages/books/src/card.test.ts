import { describe, expect, it } from "vitest";
import {
  amountPrinted,
  cardVendor,
  csvRows,
  descriptorOf,
  fingerprints,
  parseStatement,
  statementDay,
} from "./card.js";

const OFX = `OFXHEADER:100
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>CAD
<CCACCTFROM><ACCTID>5555000000001234</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261004120000<TRNAMT>-21.37<FITID>A1<NAME>DYNADOT LLC<MEMO>SAN MATEO CA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>500.00<FITID>A2<NAME>PAYMENT RECEIVED</STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

const CSV = `Following data is valid as of 20261010
\r
Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description
1,'5555********1234,20261003,20261004,13.56,"X CORP. PAID FEATURES, SAN FRANCISCO"
2,'5555********1234,20261003,20261004,13.56,"X CORP. PAID FEATURES, SAN FRANCISCO"
3,'5555********1234,20261005,20261006,-500.00,PAYMENT RECEIVED - THANK YOU
4,'5555********1234,20261007,20261008,8.99,TOO GOOD TO GO
`;

describe("statements", () => {
  it("reads OFX: purchases charged, the bank's ids kept", () => {
    expect(parseStatement(OFX)).toEqual([
      {
        card: "1234",
        on: "2026-10-04",
        description: "DYNADOT LLC SAN MATEO CA",
        amountCents: 2137,
        currency: "CAD",
        bankId: "A1",
      },
      expect.objectContaining({ amountCents: -50000, bankId: "A2" }),
    ]);
  });

  it("reads BMO's CSV under its note, quoted commas and all", () => {
    const lines = parseStatement(CSV);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({
      card: "1234",
      on: "2026-10-03",
      description: "X CORP. PAID FEATURES, SAN FRANCISCO",
      amountCents: 1356,
    });
    expect(lines[2]?.amountCents).toBe(-50000);
  });

  it("flips a file that signs charges negative", () => {
    const flipped = CSV.replace(/,(-?)(\d+\.\d\d),/g, (_, m, n) => `,${m ? "" : "-"}${n},`);
    expect(parseStatement(flipped).map((l) => l.amountCents)).toEqual([1356, 1356, -50000, 899]);
  });

  it("needs a card when the file has none", () => {
    const bare = "Date,Description,Amount\n2026-10-01,GITHUB,5.00\n";
    expect(() => parseStatement(bare)).toThrow(/last four/);
    expect(parseStatement(bare, "1234")[0]).toMatchObject({ card: "1234", amountCents: 500 });
  });

  it("two like charges on one day are two lines, the same on every import", () => {
    const a = fingerprints(parseStatement(CSV));
    expect(new Set(a).size).toBe(4);
    expect(fingerprints(parseStatement(CSV))).toEqual(a);
  });
});

describe("descriptors", () => {
  it("drops numbers and punctuation, and finds the vendor by whole words", () => {
    expect(descriptorOf("DYNADOT.COM 650-262-0100 CA")).toBe("DYNADOT COM CA");
    expect(cardVendor(descriptorOf("X CORP. PAID FEATURES"))?.key).toBe("x");
    expect(cardVendor(descriptorOf("AWS.AMAZON.CO WA"))?.key).toBe("aws");
    expect(cardVendor(descriptorOf("LAWSON STORE"))).toBeNull();
    expect(cardVendor(descriptorOf("TOO GOOD TO GO"))).toBeNull();
  });

  it("reads the days banks print", () => {
    expect(statementDay("20261004")).toBe("2026-10-04");
    expect(statementDay("10/4/2026")).toBe("2026-10-04");
    expect(statementDay("Oct 4, 2026")).toBe("2026-10-04");
  });

  it("keeps an alert's amount only when the mail prints it", () => {
    expect(amountPrinted(1234.5, "A purchase of $1,234.50 at DYNADOT")).toBe(true);
    expect(amountPrinted(21.37, "A purchase of $21.37")).toBe(true);
    expect(amountPrinted(21.73, "A purchase of $21.37")).toBe(false);
  });

  it("splits CSV rows with quotes and CRLF", () => {
    expect(csvRows('a,"b ""c"", d"\r\n1,2\n')).toEqual([
      ["a", 'b "c", d'],
      ["1", "2"],
    ]);
  });
});
