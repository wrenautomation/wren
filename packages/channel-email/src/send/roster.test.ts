/** The sending-fleet roster (D43): every defect refuses loudly. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activeSenders, loadRoster, RosterError, senderDomain } from "./roster.js";

const NICHES: ReadonlySet<string> = new Set(["agencies", "sec_ria"]);

function rosterFile(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "roster-")), "senders_config.toml");
  writeFileSync(path, text, "utf8");
  return path;
}

const GOOD = `
[[senders]]
address = "will@wren-automation.com"
display_name = "Will Jin"
niches = ["agencies"]

[[senders]]
address = "wildcard@wren-automation.org"
niches = "all"

[[senders]]
address = "carveout@wren-automation.org"
niches = "all"
except = ["agencies"]

[[senders]]
address = "William@wren-automation.net"
niches = ["agencies", "sec_ria"]
suspended = true
`;

describe("loadRoster", () => {
  it("loads, normalizes and preserves order", () => {
    const roster = loadRoster(rosterFile(GOOD), NICHES);
    expect(roster.map((s) => s.address)).toEqual([
      "will@wren-automation.com",
      "wildcard@wren-automation.org",
      "carveout@wren-automation.org",
      "william@wren-automation.net",
    ]);
    const first = roster[0];
    if (!first) throw new Error("empty roster");
    expect(senderDomain(first)).toBe("wren-automation.com");
    expect(roster[0]?.niches).toEqual(["agencies"]);
    expect(roster[1]?.niches).toBeNull();
    expect(roster[2]?.niches).toBeNull();
    expect(roster[2]?.excludedNiches).toEqual(["agencies"]);
    expect(roster[0]?.suspended).toBe(false);
    expect(roster[3]?.suspended).toBe(true);
  });

  it("display name is optional and opt-in", () => {
    const roster = loadRoster(rosterFile(GOOD), NICHES);
    expect(roster[0]?.displayName).toBe("Will Jin");
    expect(roster[1]?.displayName).toBeNull();
    const padded =
      "[[senders]]\naddress = 'a@b.com'\ndisplay_name = '  Will Jin  '\nniches = 'all'\n";
    expect(loadRoster(rosterFile(padded), NICHES)[0]?.displayName).toBe("Will Jin");
  });

  it("active senders drop suspended and scope by niche", () => {
    const roster = loadRoster(rosterFile(GOOD), NICHES);
    expect(activeSenders(roster).map((s) => s.address)).toEqual([
      "will@wren-automation.com",
      "wildcard@wren-automation.org",
      "carveout@wren-automation.org",
    ]);
    expect(activeSenders(roster, "agencies").map((s) => s.address)).toEqual([
      "will@wren-automation.com",
      "wildcard@wren-automation.org",
    ]);
    expect(activeSenders(roster, "sec_ria").map((s) => s.address)).toEqual([
      "wildcard@wren-automation.org",
      "carveout@wren-automation.org",
    ]);
  });

  it.each([
    ["", /no \[\[senders\]\] entries/],
    ["[[senders]]\nniches = ['agencies']\n", /'address' must be/],
    ["[[senders]]\naddress = 'not-an-email'\nniches = ['agencies']\n", /not an email/],
    ["[[senders]]\naddress = 'a@b'\nniches = ['agencies']\n", /not an email/],
    ["[[senders]]\naddress = 'a@b.com'\nniches = []\n", /'niches' must be/],
    ["[[senders]]\naddress = 'a@b.com'\n", /'niches' must be/],
    ["[[senders]]\naddress = 'a@b.com'\nniches = ['all']\n", /string form/],
    [
      "[[senders]]\naddress = 'a@b.com'\nniches = ['agencies']\nexcept = ['sec_ria']\n",
      /only carves/,
    ],
    ["[[senders]]\naddress = 'a@b.com'\nniches = 'all'\nexcept = []\n", /'except' must be/],
    ["[[senders]]\naddress = 'a@b.com'\nniches = 'all'\nexcept = ['agences']\n", /unknown niche/],
    ["[[senders]]\naddress = 'a@b.com'\nniches = ['agencies']\nsuspnded = true\n", /unknown key/],
    [
      "[[senders]]\naddress = 'a@b.com'\nniches = ['agencies']\nsuspended = 'yes'\n",
      /'suspended' must be/,
    ],
    [
      "[[senders]]\naddress = 'a@b.com'\nniches = 'all'\ndisplay_name = 42\n",
      /'display_name' must be/,
    ],
    [
      "[[senders]]\naddress = 'a@b.com'\nniches = 'all'\ndisplay_name = '  '\n",
      /'display_name' must be/,
    ],
    ["not toml [", /not valid TOML/],
  ])("defective rosters refuse loudly (%j)", (text, match) => {
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow(RosterError);
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow(match);
  });

  it("duplicate addresses refuse even across case", () => {
    const text = `${GOOD}\n[[senders]]\naddress = 'WILL@wren-automation.com'\nniches = ['agencies']\n`;
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow("appears twice");
  });

  it("unknown niche refuses naming the registered ones", () => {
    const text = "[[senders]]\naddress = 'a@b.com'\nniches = ['agences']\n";
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow(
      /unknown niche.*agences.*registered.*agencies/,
    );
  });

  it("missing file is configuration trouble", () => {
    expect(() =>
      loadRoster(join(mkdtempSync(join(tmpdir(), "roster-")), "senders_config.toml")),
    ).toThrow("not found");
  });
});

const WITH_SIGNATURE = `
[signature]
text = """
--
William Jin
Founder, Wren Automation
wrenautomation.com
"""
html = """
--<br>
<b>William Jin</b><br>
Founder, Wren Automation<br>
<a href="https://wrenautomation.com" style="color:#888888">wrenautomation.com</a>
"""

[[senders]]
address = "a@x.com"
niches = "all"
`;

describe("the sign-off block", () => {
  it("both forms load and every sender carries them", () => {
    const roster = loadRoster(rosterFile(WITH_SIGNATURE), NICHES);
    expect(roster[0]?.signature?.text).toBe(
      "--\nWilliam Jin\nFounder, Wren Automation\nwrenautomation.com",
    );
    expect(roster[0]?.signature?.html).toContain("<b>William Jin</b>");
  });
  it("no signature table means nobody signs", () => {
    expect(loadRoster(rosterFile(GOOD), NICHES).every((s) => s.signature === null)).toBe(true);
  });
  it("the two forms must say the same thing", () => {
    const text =
      '[signature]\ntext = "--\\nWilliam Jin"\nhtml = "--<br><b>Will Jin</b>"\n\n[[senders]]\naddress = "a@x.com"\nniches = "all"\n';
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow("say different things");
  });
  it("markup differences that change no words are fine", () => {
    const text =
      '[signature]\ntext = "--\\nWilliam Jin"\nhtml = "--<br><span style=\'font-weight:bold;color:#111\'>William Jin</span>"\n\n[[senders]]\naddress = "a@x.com"\nniches = "all"\n';
    expect(loadRoster(rosterFile(text), NICHES)[0]?.signature).not.toBeNull();
  });
  it("the page slot is filled per niche in both forms", () => {
    const text =
      '[signature]\ntext = "--\\nwrenautomation.com{page}"\nhtml = "--<br><a href=\\"https://wrenautomation.com{page}\\">wrenautomation.com{page}</a>"\n\n[[senders]]\naddress = "a@x.com"\nniches = "all"\n';
    const signature = loadRoster(rosterFile(text), NICHES)[0]?.signature;
    const signed = signature?.forPage("/agencies");
    expect(signed?.text).toBe("--\nwrenautomation.com/agencies");
    expect(signed?.html).toContain('href="https://wrenautomation.com/agencies"');
    const bare = signature?.forPage("");
    expect(bare?.text).toBe("--\nwrenautomation.com");
    expect(bare?.html).not.toContain("{page}");
  });
  it("half a signature is refused", () => {
    const text = '[signature]\ntext = "--"\n\n[[senders]]\naddress = "a@x.com"\nniches = "all"\n';
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow("'html' must be a non-blank string");
  });
  it("an unknown signature key refuses rather than being ignored", () => {
    const text =
      '[signature]\ntext = "--"\nhtml = "--"\nfooter = "x"\n\n[[senders]]\naddress = "a@x.com"\nniches = "all"\n';
    expect(() => loadRoster(rosterFile(text), NICHES)).toThrow("knows only 'text' and 'html'");
  });
});
