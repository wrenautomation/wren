import { describe, expect, it } from "vitest";
import { seededRng, simulateHistory, usDate } from "./history.js";
import { guessEmail, messUp, type SeedRow, toBullhornCsv } from "./seed.js";

const today = new Date("2026-09-29T12:00:00Z");
const YEAR = 365 * 86_400_000;

describe("seededRng", () => {
  it("same seed, same numbers; another seed, others", () => {
    const a = seededRng("acme.com");
    const b = seededRng("acme.com");
    const c = seededRng("beta.com");
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe("simulateHistory", () => {
  it("dates fall in order and in their windows", () => {
    const rng = seededRng("orders");
    let placed = 0;
    for (let i = 0; i < 500; i++) {
      const h = simulateHistory(rng, today);
      const age = today.getTime() - h.created.getTime();
      expect(age).toBeGreaterThanOrEqual(3 * YEAR - 86_400_000);
      expect(age).toBeLessThanOrEqual(10 * YEAR + 86_400_000);
      if (h.lastContacted) {
        expect(h.lastContacted.getTime()).toBeGreaterThan(h.created.getTime());
        expect(h.lastContacted.getTime()).toBeLessThan(today.getTime());
      }
      if (h.lastPlacement) {
        placed++;
        expect(h.lastPlacement.getTime()).toBeGreaterThan(h.created.getTime());
        expect(h.lastPlacement.getTime()).toBeLessThanOrEqual((h.lastContacted ?? today).getTime());
      }
    }
    expect(placed / 500).toBeGreaterThan(0.45);
    expect(placed / 500).toBeLessThan(0.7);
  });

  it("usDate writes MM/DD/YYYY; blank for none", () => {
    expect(usDate(new Date("2024-03-05T00:00:00Z"))).toBe("03/05/2024");
    expect(usDate(null)).toBe("");
  });
});

describe("guessEmail", () => {
  it("ascii letters only", () => {
    expect(guessEmail("José", "O'Neil-Smith", "acme.com")).toBe("jose.oneilsmith@acme.com");
    expect(guessEmail("李", "Wang", "acme.com")).toBeNull();
  });
});

const row = (i: number): SeedRow => ({
  id: String(i),
  firstName: "Jane",
  lastName: `Doe${i}`,
  email: `jane.doe${i}@acme.com`,
  title: "Talent Lead",
  company: "Acme",
  website: "https://acme.com",
  linkedin: "",
  owner: "Sam Patel",
  status: "Client",
  created: "01/02/2020",
  lastContacted: "",
  lastPlacement: "",
});

describe("messUp", () => {
  it("keeps every person; a duplicate is the same address in capitals with a new id", () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i + 1));
    const messy = messUp(seededRng("mess"), rows);
    const emails = new Set(messy.map((r) => r.email.toLowerCase()));
    expect(emails.size).toBe(200);
    expect(new Set(messy.map((r) => r.id)).size).toBe(messy.length);
    const dupes = messy.length - 200;
    expect(dupes).toBeGreaterThan(0);
    expect(dupes).toBeLessThan(25);
    expect(messy.filter((r) => r.email === r.email.toUpperCase())).toHaveLength(dupes);
    expect(messy.filter((r) => !r.title).length).toBeGreaterThan(10);
  });
});

describe("toBullhornCsv", () => {
  it("quotes what needs it", () => {
    const csv = toBullhornCsv([{ ...row(1), company: 'Acme, "the" Co' }]);
    const [head, line] = csv.split("\r\n");
    expect(head).toBe(
      "ID,First Name,Last Name,Email,Title,Client Corporation,Website,LinkedIn,Recruiter,Status,Date Added,Date Last Note,Date of Last Placement",
    );
    expect(line).toContain(',"Acme, ""the"" Co",');
  });
});
