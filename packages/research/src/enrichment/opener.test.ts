/** Opener grounding, evidence and prompt: pure, no DB, no LLM. */
import { describe, expect, it } from "vitest";
import {
  buildOpenerPrompt,
  countOpener,
  type EvidencePage,
  emptyOpenerStats,
  foldText,
  groundOpener,
  OPENER_MAX_WORDS,
  OpenerProposal,
  openerEvidence,
  type SitePage,
} from "./opener.js";

const HOME: EvidencePage = {
  url: "https://acme.example/",
  text: "Acme Staffing places nurses in Tulsa hospitals.\nWe’ve  served   Oklahoma employers since 1999 with 1,000 placements a year.",
};
const ABOUT: EvidencePage = {
  url: "https://acme.example/about",
  text: "Founded in 1999 by two ICU nurses, we built a bench of travel nurses for rural clinics across Canada.",
};
const PAGES = [HOME, ABOUT];

const propose = (line: string | null, quote: string | null, source_url: string | null = HOME.url) =>
  OpenerProposal.parse({ line, quote, source_url });

describe("groundOpener", () => {
  it("accepts a faithful quote with curly quotes, whitespace and case folded", () => {
    const quote = "WE'VE SERVED oklahoma employers\nsince 1999";
    const r = groundOpener(
      propose("You have served Oklahoma employers since 1999.", quote),
      PAGES,
      "Acme Staffing",
    );
    expect(r).toEqual({
      opener: {
        line: "You have served Oklahoma employers since 1999.",
        quote,
        source_url: HOME.url,
      },
      rejected: null,
    });
  });

  it("folds curly quotes in the quote against straight quotes on the page", () => {
    const page = {
      url: "https://b.example/",
      text: `We call it the "night shift desk" and it never closes.`,
    };
    const r = groundOpener(
      propose(
        "Your night shift desk never closes.",
        "We call it the “night shift desk” and it never closes",
        page.url,
      ),
      [page],
    );
    expect(r.rejected).toBeNull();
    expect(r.opener?.source_url).toBe(page.url);
  });

  it("trims the line and quote it keeps", () => {
    const r = groundOpener(
      propose("  You place nurses in Tulsa hospitals.  ", "  places nurses in Tulsa hospitals  "),
      PAGES,
    );
    expect(r.opener).toEqual({
      line: "You place nurses in Tulsa hospitals.",
      quote: "places nurses in Tulsa hospitals",
      source_url: HOME.url,
    });
  });

  it("fixes a wrong source_url to the page that has the quote", () => {
    const quote = "we built a bench of travel nurses for rural clinics";
    const line = "You built a bench of travel nurses for rural clinics.";
    expect(groundOpener(propose(line, quote, HOME.url), PAGES).opener?.source_url).toBe(ABOUT.url);
    expect(
      groundOpener(propose(line, quote, "https://acme.example/careers"), PAGES).opener?.source_url,
    ).toBe(ABOUT.url);
    expect(groundOpener(propose(line, quote, null), PAGES).opener?.source_url).toBe(ABOUT.url);
  });

  it("prefers the named page when several pages carry the quote", () => {
    const a = { url: "https://c.example/", text: "We staff rural clinics every week." };
    const b = { url: "https://c.example/about", text: "We staff rural clinics every week." };
    const r = groundOpener(
      propose("You staff rural clinics every week.", "We staff rural clinics", b.url),
      [a, b],
    );
    expect(r.opener?.source_url).toBe(b.url);
  });

  it("allows exactly the word limit and rejects one more as too_long", () => {
    const quote = "places nurses in Tulsa hospitals";
    const words = (n: number) => `You ${Array.from({ length: n - 1 }, () => "place").join(" ")}.`;
    expect(OPENER_MAX_WORDS).toBe(25);
    expect(groundOpener(propose(words(25), quote), PAGES).rejected).toBeNull();
    expect(groundOpener(propose(words(26), quote), PAGES)).toEqual({
      opener: null,
      rejected: "too_long",
    });
  });

  it("rejects exclamation, question, em dash, en dash and spaced hyphen as style", () => {
    const quote = "places nurses in Tulsa hospitals";
    for (const line of [
      "You place nurses in Tulsa hospitals!",
      "You place nurses in Tulsa hospitals?",
      "You place nurses — in Tulsa hospitals.",
      "You place nurses – in Tulsa hospitals.",
      "You place nurses - in Tulsa hospitals.",
    ]) {
      expect(groundOpener(propose(line, quote), PAGES), line).toEqual({
        opener: null,
        rejected: "style",
      });
    }
  });

  it("rejects the other dashes and a line break as style", () => {
    const quote = "places nurses in Tulsa hospitals";
    for (const line of [
      "You place nurses ― in Tulsa hospitals.",
      "You place nurses -- in Tulsa hospitals.",
      "You place nurses.\nIn Tulsa hospitals.",
    ]) {
      expect(groundOpener(propose(line, quote), PAGES).rejected, line).toBe("style");
    }
  });

  it("rejects a line about who owns the firm, even when quoted", () => {
    const page = {
      url: "https://o.example/",
      text: "We have been woman and nurse owned since 1990. Veteran-led and proud.",
    };
    for (const [line, quote] of [
      ["You've been woman and nurse owned since 1990.", "woman and nurse owned since 1990"],
      ["You're veteran-led and proud of it.", "Veteran-led and proud"],
    ] as const) {
      expect(groundOpener(propose(line, quote, page.url), [page]).rejected, line).toBe("ownership");
    }
  });

  it("rejects a line repeating the firm's marketing", () => {
    const page = {
      url: "https://m.example/",
      text: "A trusted partner delivering top-tier, compassionate care to Tulsa hospitals.",
    };
    const r = groundOpener(
      propose(
        "You deliver top-tier, compassionate care to Tulsa hospitals.",
        "delivering top-tier, compassionate care to Tulsa hospitals",
        page.url,
      ),
      [page],
    );
    expect(r.rejected).toBe("puffery");
  });

  it("keeps a plain line that names a community it serves", () => {
    const page = {
      url: "https://v.example/",
      text: "We place veterans in best-fit civilian roles across Ohio.",
    };
    const r = groundOpener(
      propose(
        "You place veterans in best-fit civilian roles across Ohio.",
        "We place veterans in best-fit civilian roles across Ohio",
        page.url,
      ),
      [page],
    );
    expect(r.rejected).toBeNull();
  });

  it("accepts a quote joining two sentences of one page, not two pages", () => {
    const quote = "We place nurses in Tulsa hospitals. Founded in 1999 by two ICU nurses";
    const line = "You place nurses in Tulsa hospitals and started in 1999.";
    const home = {
      url: "https://j.example/",
      text: "We place nurses in Tulsa hospitals. Our team is local. Founded in 1999 by two ICU nurses.",
    };
    expect(groundOpener(propose(line, quote, home.url), [home]).rejected).toBeNull();
    const split = [
      { url: "https://j.example/", text: "We place nurses in Tulsa hospitals." },
      { url: "https://j.example/about", text: "Founded in 1999 by two ICU nurses." },
    ];
    expect(groundOpener(propose(line, quote, home.url), split).rejected).toBe("quote_not_found");
  });

  it("rejects a quote whose sentence was cut mid-way", () => {
    const page = {
      url: "https://k.example/",
      text: "We place nurses in Tulsa hospitals and clinics. We started in 1999.",
    };
    const r = groundOpener(
      propose(
        "You place nurses in Tulsa hospitals.",
        "We place nurses in hospitals. We started in 1999",
        page.url,
      ),
      [page],
    );
    expect(r.rejected).toBe("quote_not_found");
  });

  it("does not treat an abbreviation like U.S. as a name", () => {
    const page = { url: "https://u.example/", text: "We staff warehouses across the country." };
    const r = groundOpener(
      propose(
        "You staff warehouses across the U.S.",
        "We staff warehouses across the country",
        page.url,
      ),
      [page],
    );
    expect(r.rejected).toBeNull();
  });

  it("keeps a hyphenated word", () => {
    const page = {
      url: "https://d.example/",
      text: "We run long-term contracts for Tulsa hospitals.",
    };
    const r = groundOpener(
      propose(
        "You run long-term contracts for Tulsa hospitals.",
        "We run long-term contracts",
        page.url,
      ),
      [page],
    );
    expect(r.rejected).toBeNull();
  });

  it("rejects a missing or under three word quote as no_quote", () => {
    const line = "You place nurses in Tulsa hospitals.";
    expect(groundOpener(propose(line, null), PAGES).rejected).toBe("no_quote");
    expect(groundOpener(propose(line, "  "), PAGES).rejected).toBe("no_quote");
    expect(groundOpener(propose(line, "Tulsa hospitals"), PAGES).rejected).toBe("no_quote");
    expect(groundOpener(propose(line, "in Tulsa hospitals"), PAGES).rejected).toBeNull();
  });

  it("rejects a quote on no page as quote_not_found", () => {
    const r = groundOpener(
      propose("You place engineers in Denver.", "we place engineers in Denver"),
      PAGES,
    );
    expect(r).toEqual({ opener: null, rejected: "quote_not_found" });
    expect(groundOpener(propose("You place nurses.", "places nurses in Tulsa"), []).rejected).toBe(
      "quote_not_found",
    );
  });

  it("rejects a line number that is not in the quote", () => {
    const quote = "served Oklahoma employers since 1999";
    expect(
      groundOpener(propose("You have served Oklahoma employers since 1998.", quote), PAGES)
        .rejected,
    ).toBe("number_not_in_quote");
    // 1999 is on the page, but not in the quote the line rests on.
    expect(
      groundOpener(
        propose(
          "You built a bench of travel nurses for rural clinics in 1999.",
          "we built a bench of travel nurses for rural clinics",
        ),
        PAGES,
      ).rejected,
    ).toBe("number_not_in_quote");
  });

  it("matches numbers across thousands separators and trailing punctuation", () => {
    const quote = "with 1,000 placements a year";
    expect(
      groundOpener(propose("You make 1000 placements a year.", quote), PAGES).rejected,
    ).toBeNull();
    expect(
      groundOpener(propose("You make 1,000 placements a year.", quote), PAGES).rejected,
    ).toBeNull();
    const page = { url: "https://e.example/", text: "We make 2500 placements a year, since 1987." };
    expect(
      groundOpener(
        propose(
          "You make 2,500 placements a year, since 1987.",
          "We make 2500 placements a year, since 1987.",
          page.url,
        ),
        [page],
      ).rejected,
    ).toBeNull();
  });

  it("rejects a capitalized name that is on no page", () => {
    const r = groundOpener(
      propose(
        "You place nurses in Tulsa and Wichita hospitals.",
        "places nurses in Tulsa hospitals",
      ),
      PAGES,
    );
    expect(r).toEqual({ opener: null, rejected: "name_not_on_page" });
  });

  it("allows the company's own name even when no page has it", () => {
    const line = "You built Brightpath on travel nurses for rural clinics.";
    const quote = "we built a bench of travel nurses for rural clinics";
    expect(groundOpener(propose(line, quote), PAGES).rejected).toBe("name_not_on_page");
    expect(
      groundOpener(propose(line, quote), PAGES, "Brightpath Staffing LLC").rejected,
    ).toBeNull();
  });

  it("skips the first word and the pronoun I", () => {
    const r = groundOpener(
      propose(
        "Reading your site I saw you place nurses in Tulsa hospitals.",
        "places nurses in Tulsa hospitals",
      ),
      PAGES,
    );
    expect(r.rejected).toBeNull();
  });

  it("strips a straight possessive before looking the name up", () => {
    const r = groundOpener(
      propose("You place nurses in Tulsa's hospitals.", "places nurses in Tulsa hospitals"),
      PAGES,
    );
    expect(r.rejected).toBeNull();
  });

  it("strips a curly possessive before looking the name up", () => {
    const r = groundOpener(
      propose("You place nurses in Tulsa’s hospitals.", "places nurses in Tulsa hospitals"),
      PAGES,
    );
    expect(r.rejected).toBeNull();
  });

  it("does not count a name that only appears inside a longer word", () => {
    // "Ada" is not on any page; "Canada" is.
    const r = groundOpener(
      propose(
        "You built a bench of travel nurses for Ada clinics.",
        "we built a bench of travel nurses for rural clinics",
      ),
      PAGES,
    );
    expect(r.rejected).toBe("name_not_on_page");
  });

  it("no line is no opener and no rejection", () => {
    expect(groundOpener(propose(null, null, null), PAGES)).toEqual({
      opener: null,
      rejected: null,
    });
    expect(groundOpener(propose("   ", "places nurses in Tulsa"), PAGES)).toEqual({
      opener: null,
      rejected: null,
    });
    expect(groundOpener(OpenerProposal.parse({}), PAGES)).toEqual({ opener: null, rejected: null });
  });
});

describe("OpenerProposal", () => {
  it("missing keys read as null", () => {
    expect(OpenerProposal.parse({})).toEqual({ line: null, quote: null, source_url: null });
    expect(OpenerProposal.parse({ line: "x" })).toEqual({
      line: "x",
      quote: null,
      source_url: null,
    });
  });
  it("refuses a non-string line", () => {
    expect(OpenerProposal.safeParse({ line: 5 }).success).toBe(false);
  });
});

describe("foldText", () => {
  it("folds case, whitespace, curly quotes and dashes", () => {
    expect(foldText("  We’ve “Always”\n\t‘Placed’ Nurses – ICU—ER  ")).toBe(
      `we've "always" 'placed' nurses - icu-er`,
    );
    expect(foldText("ﬁrst shift…")).toBe("first shift...");
  });
});

const at = (iso: string) => new Date(iso);
const page = (url: string, text: string, fetchedAt = "2026-01-01T00:00:00Z"): SitePage => ({
  url,
  text,
  fetchedAt: at(fetchedAt),
});

describe("openerEvidence", () => {
  it("newest copy per URL wins, whatever the input order", () => {
    const old = page("https://x.example/", "old text", "2026-01-01T00:00:00Z");
    const fresh = page("https://x.example/", "new text", "2026-02-01T00:00:00Z");
    expect(openerEvidence([old, fresh])).toEqual([{ url: "https://x.example/", text: "new text" }]);
    expect(openerEvidence([fresh, old])).toEqual([{ url: "https://x.example/", text: "new text" }]);
  });

  it("drops blank text, so an older copy with text stands in for a blank newer one", () => {
    expect(openerEvidence([page("https://x.example/a", " \n\t ")])).toEqual([]);
    const out = openerEvidence([
      page("https://x.example/", "kept", "2026-01-01T00:00:00Z"),
      page("https://x.example/", "   ", "2026-03-01T00:00:00Z"),
    ]);
    expect(out).toEqual([{ url: "https://x.example/", text: "kept" }]);
  });

  it("homepage first, then about-like pages, then the rest, each by URL", () => {
    const urls = [
      "https://x.example/services",
      "https://x.example/our-story",
      "not a url",
      "https://x.example/contact",
      "https://x.example/about-us",
      "https://x.example",
      "https://x.example/team",
    ];
    expect(openerEvidence(urls.map((u) => page(u, `text of ${u}`))).map((p) => p.url)).toEqual([
      "https://x.example",
      "https://x.example/about-us",
      "https://x.example/our-story",
      "https://x.example/team",
      "https://x.example/contact",
      "https://x.example/services",
      "not a url",
    ]);
  });

  it("cuts each page to 3500 characters and stops at 10000 in all", () => {
    const big = (c: string) => c.repeat(5000);
    const out = openerEvidence([
      page("https://x.example/", big("a")),
      page("https://x.example/about", big("b")),
      page("https://x.example/services", big("c")),
      page("https://x.example/zzz", big("d")),
    ]);
    expect(out.map((p) => [p.url, p.text.length])).toEqual([
      ["https://x.example/", 3500],
      ["https://x.example/about", 3500],
      ["https://x.example/services", 3000],
    ]);
    expect(out[0]?.text).toBe("a".repeat(3500));
  });

  it("keeps a short page whole", () => {
    expect(openerEvidence([page("https://x.example/", "short")])).toEqual([
      { url: "https://x.example/", text: "short" },
    ]);
  });
});

describe("buildOpenerPrompt", () => {
  it("inserts page text and company name literally, replacement patterns included", () => {
    const text = "Save $& now. Also $' and $` and $$ and $1 and {company}.";
    const prompt = buildOpenerPrompt("Dollar $& Staffing", [{ url: "https://x.example/", text }]);
    expect(prompt).toContain(`=== https://x.example/\n${text}`);
    expect(prompt).toContain("owner of Dollar $& Staffing.");
    expect(prompt).toContain("Company: Dollar $& Staffing\n");
    expect(prompt).not.toContain("{pages}");
  });

  it("separates pages with their URL headers, in order", () => {
    const prompt = buildOpenerPrompt("Acme", [
      { url: "https://x.example/", text: "home" },
      { url: "https://x.example/about", text: "about" },
    ]);
    expect(prompt).toContain(
      "PAGES:\n=== https://x.example/\nhome\n\n=== https://x.example/about\nabout\n",
    );
    expect(prompt).not.toContain("{company}");
  });
});

describe("countOpener", () => {
  it("counts each outcome and rejections by reason", () => {
    const stats = emptyOpenerStats(7);
    countOpener(stats, { outcome: "written", rejected: null });
    countOpener(stats, { outcome: "no_line", rejected: null });
    countOpener(stats, { outcome: "rejected", rejected: "style" });
    countOpener(stats, { outcome: "rejected", rejected: "style" });
    countOpener(stats, { outcome: "rejected", rejected: "too_long" });
    countOpener(stats, { outcome: "parse_error", rejected: null });
    countOpener(stats, { outcome: "provider_rejected", rejected: null });
    countOpener(stats, { outcome: "no_pages", rejected: null });
    expect(stats).toEqual({
      selected: 7,
      written: 1,
      no_line: 1,
      rejected: { style: 2, too_long: 1 },
      parse_errors: 1,
      provider_rejected: 1,
      no_pages: 1,
      aborted: null,
    });
  });
});
