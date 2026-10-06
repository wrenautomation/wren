import { describe, expect, it } from "vitest";
import { heldPageText } from "./study.js";

/** A one-page PDF saying `line`, offsets computed so any reader accepts it. */
function tinyPdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("heldPageText", () => {
  it("reads a PDF's text", async () => {
    const text = await heldPageText(tinyPdf("Synthetic firms report 38% repeat clients"), "r.pdf");
    expect(text).toContain("Synthetic firms report 38% repeat clients");
  });

  it("strips HTML and keeps plain text as is", async () => {
    const html = new TextEncoder().encode("<html><body><p>Fees are 20%</p></body></html>");
    expect((await heldPageText(html, "saved.html")).trim()).toBe("Fees are 20%");
    const txt = new TextEncoder().encode("plain <b>notes</b>");
    expect(await heldPageText(txt, "notes.txt")).toBe("plain <b>notes</b>");
  });
});
