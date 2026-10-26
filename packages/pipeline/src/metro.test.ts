import { describe, expect, it } from "vitest";
import { ctx, metroShape, shape } from "../test/fixtures.js";
import {
  ATTACH_KINDS,
  type Attach,
  checkMetro,
  isContentKind,
  isMetro,
  kindOfAction,
  LOGIC_KINDS,
  type MetroBody,
  type MetroFlow,
  type MetroStation,
  type MetroTrack,
  STATION_KINDS,
  TRACK_KINDS,
} from "./metro.js";
import { ACTIONS } from "./model.js";

/** What `checkMetro` says about `metroShape()` after `edit` changed it. */
const says = (edit: (b: MetroBody) => void): string[] => {
  const b = metroShape();
  edit(b);
  return checkMetro(b, ctx());
};
const station = (b: MetroBody, id: string): MetroStation => {
  const s = b.stations.find((x) => x.id === id);
  if (!s) throw new Error(`no station ${id}`);
  return s;
};
const track = (b: MetroBody, id: string): MetroTrack => {
  const t = b.tracks.find((x) => x.id === id);
  if (!t) throw new Error(`no track ${id}`);
  return t;
};
const extra = (over: Partial<MetroStation> = {}): MetroStation => ({
  id: "extra",
  label: "Extra",
  kind: "att",
  line: "growth",
  column: "sales",
  action: "other",
  ...over,
});

describe("metroShape()", () => {
  it("passes checkMetro", () => {
    expect(checkMetro(metroShape(), ctx())).toEqual([]);
  });

  it("holds every station kind, track kind and logic kind", () => {
    const b = metroShape();
    // Content stations sit on a content line alone; content-line.test.ts holds them.
    expect(new Set(b.stations.map((s) => s.kind))).toEqual(
      new Set(STATION_KINDS.filter((k) => !isContentKind(k))),
    );
    expect(new Set(b.tracks.flatMap((t) => (t.kind ? [t.kind] : [])))).toEqual(
      new Set(TRACK_KINDS),
    );
    expect(b.tracks.some((t) => t.kind === undefined)).toBe(true);
    for (const k of LOGIC_KINDS) expect(b.stations.some((s) => s.kind === k)).toBe(true);
    for (const f of ["cond", "else", "wait", "weight", "entries", "owner", "promise", "label"]) {
      expect(b.tracks.some((t) => f in t)).toBe(true);
    }
  });

  it("lets a line and a station share an id", () => {
    const b = metroShape();
    expect(b.lines.some((l) => l.id === "social")).toBe(true);
    expect(b.stations.some((s) => s.id === "social")).toBe(true);
  });
});

describe("isMetro and kindOfAction", () => {
  it("tells a metro body from a graph", () => {
    expect(isMetro(metroShape())).toBe(true);
    expect(isMetro(shape())).toBe(false);
    expect(isMetro(null)).toBe(false);
    expect(isMetro("metro")).toBe(false);
    expect(isMetro({ model: "graph" })).toBe(false);
  });

  it("makes call, book and held take time and every other action need attention", () => {
    const time = ACTIONS.filter((a) => kindOfAction(a) === "time");
    expect(time).toEqual(["call", "book", "held"]);
    for (const a of ACTIONS.filter((x) => !time.includes(x))) expect(kindOfAction(a)).toBe("att");
  });
});

describe("checkMetro: names and ids", () => {
  it("wants a name", () => {
    expect(says((b) => (b.name = " "))).toEqual(["The shape needs a name."]);
  });

  it("wants ids in the id rule, at most 40 characters", () => {
    expect(says((b) => b.stations.push(extra({ id: "Bad Id" })))).toEqual([
      'Station id "Bad Id" must be lowercase letters, digits and underscores, starting with a letter.',
    ]);
    const long = "a".repeat(41);
    expect(says((b) => b.stations.push(extra({ id: long })))).toEqual([
      `Station id "${long}" is longer than 40 characters.`,
    ]);
    expect(says((b) => b.lines.push({ id: "9x", label: "X", tier: "front" }))).toEqual([
      'Line id "9x" must be lowercase letters, digits and underscores, starting with a letter.',
    ]);
  });

  it("lets a track id be as long as two node ids and _to_", () => {
    const id = `${"a".repeat(40)}_to_${"b".repeat(40)}`;
    expect(says((b) => (track(b, "reply_to_qualify").id = id))).toEqual([]);
    expect(says((b) => (track(b, "reply_to_qualify").id = `${id}c`))).toEqual([
      `Track id "${id}c" is longer than 84 characters.`,
    ]);
  });

  it("wants ids unique within each kind", () => {
    expect(says((b) => b.stations.push(extra({ id: "prep" })))).toEqual([
      'Station id "prep" is used twice.',
    ]);
    expect(says((b) => b.lines.push({ id: "growth", label: "G", tier: "front" }))).toEqual([
      'Line id "growth" is used twice.',
    ]);
    expect(says((b) => b.tracks.push({ ...track(b, "book_to_wait") }))).toEqual([
      'Track id "book_to_wait" is used twice.',
    ]);
    expect(
      says((b) => b.groups.push({ id: "closing", label: "C", line: "growth", stations: ["prep"] })),
    ).toEqual(['Group id "closing" is used twice.']);
    expect(says((b) => b.frames.push({ ...(b.frames[0] as MetroBody["frames"][number]) }))).toEqual(
      ['Frame id "stop" is used twice.'],
    );
  });

  it("reserves the station id dropped", () => {
    expect(says((b) => b.stations.push(extra({ id: "dropped" })))).toEqual([
      'Station id "dropped" is reserved for dropped journeys.',
    ]);
  });
});

describe("checkMetro: the hub", () => {
  it("wants exactly one hub station", () => {
    const none = says((b) => {
      b.stations = b.stations.filter((s) => s.id !== "hub");
      b.tracks = b.tracks.filter((t) => t.from !== "hub" && t.to !== "hub");
    });
    expect(none).toEqual(["The shape needs exactly one hub station, not 0."]);
    expect(
      says((b) => b.stations.push({ id: "hub_two", label: "H", kind: "hub", column: "marketing" })),
    ).toEqual([
      "The shape needs exactly one hub station, not 2.",
      'The hub station must have the id "hub", not "hub_two".',
    ]);
  });

  it("wants the hub id on the hub station only", () => {
    const e = says((b) => (station(b, "hub").id = "front_door"));
    expect(e).toContain('The hub station must have the id "hub", not "front_door".');
    expect(says((b) => b.stations.push(extra({ id: "hub" })))).toContain(
      'Station id "hub" is reserved for the hub station.',
    );
  });

  it("gives the hub no line", () => {
    expect(says((b) => (station(b, "hub").line = "growth"))).toEqual([
      'The hub station "hub" has no line.',
    ]);
  });

  it("lets only out-line stations enter it", () => {
    expect(
      says((b) =>
        b.tracks.push({
          id: "reply_to_hub",
          from: "reply",
          to: "hub",
          kind: "back",
          by: "system",
        }),
      ),
    ).toEqual(['Track "reply_to_hub" enters the hub from "reply", which is not on an out line.']);
  });

  it("lets it lead only to stations on a front or core line", () => {
    const e = says((b) =>
      b.tracks.push({
        id: "hub_to_social",
        from: "hub",
        to: "social",
        kind: "back",
        by: "system",
      }),
    );
    expect(e).toEqual([
      'Track "hub_to_social" leaves the hub for "social", which is not on a front or core line.',
    ]);
    const exit = says((b) =>
      b.tracks.push({ id: "hub_to_done", from: "hub", to: "done", kind: "exit", by: "system" }),
    );
    expect(exit).toEqual([
      'Track "hub_to_done" leaves the hub for "done", which is not on a front or core line.',
    ]);
  });

  it("sends a track from an out line to another line through the hub", () => {
    expect(
      says((b) =>
        b.tracks.push({
          id: "social_to_reply",
          from: "social",
          to: "reply",
          line: "growth",
          by: "system",
        }),
      ),
    ).toEqual([
      'Track "social_to_reply" leaves out line "social" for another line. Go through the hub.',
    ]);
  });

  it("allows entries only on a hub track, each an out line, not empty", () => {
    expect(says((b) => (track(b, "reply_to_qualify").entries = ["social"]))).toEqual([
      'Track "reply_to_qualify" has entries but does not leave the hub.',
    ]);
    expect(says((b) => (track(b, "hub_to_reply").entries = ["social", "growth"]))).toEqual([
      'Track "hub_to_reply" has entry "growth", which is not an out line.',
    ]);
    expect(says((b) => (track(b, "hub_to_reply").entries = ["ghost"]))).toEqual([
      'Track "hub_to_reply" has entry "ghost", which is not an out line.',
    ]);
    expect(says((b) => (track(b, "hub_to_reply").entries = []))).toEqual([
      'Track "hub_to_reply" has an empty entries list. Leave it out to take every out line.',
    ]);
  });
});

describe("checkMetro: lines", () => {
  it("wants a label and a known tier", () => {
    expect(says((b) => b.lines.push({ id: "odd", label: " ", tier: "front" }))).toEqual([
      'Line "odd" needs a label.',
    ]);
    expect(says((b) => b.lines.push({ id: "odd", label: "Odd", tier: "mid" as "out" }))).toEqual([
      'Line "odd" has tier "mid". Use out, front, core, content.',
    ]);
  });

  it("wants an entry on an out line, and no offer or colour there", () => {
    expect(says((b) => b.lines.push({ id: "bare", label: "Bare", tier: "out" }))).toEqual([
      'Line "bare" is an out line and needs an entry.',
    ]);
    const entry = { via: "organic" as const };
    expect(
      says((b) => b.lines.push({ id: "bare", label: "B", tier: "out", entry, offer: "offer-a" })),
    ).toEqual(['Line "bare" is an out line and cannot have an offer.']);
    expect(
      says((b) => b.lines.push({ id: "bare", label: "B", tier: "out", entry, colour: 1 })),
    ).toEqual(['Line "bare" is an out line and cannot have a colour.']);
  });

  it("checks how an out line finds people, as checkShape does a source", () => {
    const line = (entry: MetroBody["lines"][number]["entry"]) => (b: MetroBody) =>
      b.lines.push({ id: "bare", label: "B", tier: "out", entry: entry as never });
    expect(says(line({ via: "nope" as never }))).toEqual([
      'Out line "bare" has via "nope". Use organic, outbound, ads, referral, sourced, group, manual.',
    ]);
    expect(says(line({ via: "sourced" }))).toEqual([
      'Out line "bare" has via sourced but names no source.',
    ]);
    expect(says(line({ via: "sourced", source: "list-9" }))).toEqual([
      'Out line "bare" names source "list-9", which is not a list\'s id (import:12).',
    ]);
    expect(says(line({ via: "sourced", source: "import:99" }))).toEqual([
      'Out line "bare" names source import:99, which does not exist.',
    ]);
    expect(says(line({ via: "group" }))).toEqual([
      'Out line "bare" has via group but names no group.',
    ]);
    expect(says(line({ via: "group", segment: "x1" }))).toEqual([
      'Out line "bare" names group "x1", which is not a group\'s number.',
    ]);
    expect(says(line({ via: "group", segment: "99" }))).toEqual([
      'Out line "bare" names group 99, which does not exist.',
    ]);
    expect(says(line({ via: "group", segment: "8" }))).toEqual([
      'Out line "bare" names group 8, which is archived. Restore it first.',
    ]);
  });

  it("allows no entry on a front or core line", () => {
    expect(
      says((b) =>
        b.lines.push({ id: "odd", label: "O", tier: "front", entry: { via: "organic" } }),
      ),
    ).toEqual(['Line "odd" is not an out line and cannot have an entry.']);
  });

  it("wants a colour that is a whole number from 0 to 7", () => {
    for (const colour of [8, -1, 1.5]) {
      expect(says((b) => b.lines.push({ id: "odd", label: "O", tier: "core", colour }))).toEqual([
        `Line "odd" has colour ${colour}. Use a whole number from 0 to 7.`,
      ]);
    }
    expect(says((b) => b.lines.push({ id: "odd", label: "O", tier: "core", colour: 7 }))).toEqual(
      [],
    );
  });
});

describe("checkMetro: stations", () => {
  it("wants a label, a known kind and a known column", () => {
    expect(says((b) => b.stations.push(extra({ label: "" })))).toEqual([
      'Station "extra" needs a label.',
    ]);
    expect(says((b) => b.stations.push(extra({ kind: "box" as never })))).toContain(
      'Station "extra" has kind "box". Use att, time, cash, exit, hub, condition, race, split, join, ab, approval, link, find, read, extract, call, measure.',
    );
    expect(says((b) => b.stations.push(extra({ column: "left" as never })))).toEqual([
      'Station "extra" has column "left". Use marketing, sales, delivery, money.',
    ]);
  });

  it("wants a line, except on the hub, and on an exit where it is optional", () => {
    expect(says((b) => b.stations.push(extra({ line: undefined as never })))).toEqual([
      'Station "extra" needs a line.',
    ]);
    expect(says((b) => b.stations.push(extra({ line: "ghost" })))).toEqual([
      'Station "extra" is on line "ghost", which does not exist.',
    ]);
    expect(
      says((b) => b.stations.push({ id: "end", label: "End", kind: "exit", column: "sales" })),
    ).toEqual([]);
    expect(
      says((b) =>
        b.stations.push({ id: "end", label: "End", kind: "exit", line: "growth", column: "sales" }),
      ),
    ).toEqual([]);
  });

  it("takes an action on att and time stations only, and the kind must follow the action", () => {
    expect(says((b) => (station(b, "pay").action = "other"))).toEqual([
      'Station "pay" is a cash station. Only att and time stations take an action.',
    ]);
    expect(says((b) => (station(b, "reply").action = "book"))).toEqual([
      'Station "reply" has action "book", which makes it a time station, not att.',
    ]);
    expect(says((b) => (station(b, "book").action = "email"))).toEqual([
      'Station "book" has action "email", which makes it a att station, not time.',
    ]);
    expect(says((b) => (station(b, "reply").action = "fly" as never))).toEqual([
      'Station "reply" has action "fly". Use comment, reply, dm, email, text, call, cta, visit, form, book, held, proposal, signed, other.',
    ]);
  });

  it("wants known advance triggers", () => {
    expect(says((b) => (station(b, "reply").advance = [{ trigger: "trigger.nope" }]))).toEqual([
      'Station "reply" uses "trigger.nope", which is not a known trigger.',
    ]);
  });

  it("wants research of none, light or full and idleDays from 1 to 365", () => {
    expect(says((b) => (station(b, "reply").research = "deep" as never))).toEqual([
      'Station "reply" has research "deep". Use none, light or full.',
    ]);
    for (const idleDays of [0, 366, 1.5]) {
      expect(says((b) => (station(b, "reply").idleDays = idleDays))).toEqual([
        `Station "reply" has idleDays ${idleDays}. Use a whole number of days from 1 to 365.`,
      ]);
    }
    expect(says((b) => (station(b, "reply").idleDays = 365))).toEqual([]);
  });

  it("allows a deal on a non-cash station of a line with an offer, one per line", () => {
    expect(says((b) => (station(b, "pay").deal = true))).toEqual([
      'Station "pay" is a cash station and cannot be a deal.',
    ]);
    expect(says((b) => (station(b, "nurture_start").deal = true))).toEqual([
      'Station "nurture_start" is a deal, but its line "nurture" has no offer.',
    ]);
    expect(says((b) => (station(b, "proposal").deal = true))).toEqual([
      'Line "growth" has more than one deal station: proposal, signed.',
    ]);
  });

  it("allows terms and offer on cash only, failure on exit only, rule on join only, flow on link only", () => {
    expect(says((b) => (station(b, "reply").terms = "standard"))).toEqual([
      'Station "reply" has terms but is not a cash station.',
    ]);
    expect(says((b) => (station(b, "pay").terms = ""))).toEqual([
      'Station "pay" names no terms plan.',
    ]);
    expect(says((b) => (station(b, "reply").offer = "offer-a"))).toEqual([
      'Station "reply" has an offer but is not a cash station.',
    ]);
    expect(says((b) => (station(b, "reply").failure = true))).toEqual([
      'Station "reply" is marked failure but is not an exit.',
    ]);
    expect(says((b) => (station(b, "reply").rule = "all"))).toEqual([
      'Station "reply" has a rule but is not a join.',
    ]);
    expect(says((b) => (station(b, "reply").flow = "shared"))).toEqual([
      'Station "reply" names a flow but is not a link.',
    ]);
  });

  it("wants a flow on a link", () => {
    expect(says((b) => delete station(b, "shared").flow)).toEqual(['Link "shared" names no flow.']);
  });

  it("wants retries from 1 to 10", () => {
    for (const retries of [0, 11, 2.5]) {
      expect(says((b) => (station(b, "book").retries = retries))).toEqual([
        `Station "book" has retries ${retries}. Use a whole number from 1 to 10.`,
      ]);
    }
    expect(says((b) => (station(b, "book").retries = 10))).toEqual([]);
  });

  it("wants a template and a platform as slugs, and a platform only with a template", () => {
    expect(says((b) => (station(b, "book").platform = "x"))).toEqual([
      'Station "book" has a platform but no template.',
    ]);
    expect(says((b) => (station(b, "book").template = "Post X"))).toEqual([
      'Station "book" has template "Post X". Use a slug: a-z, 0-9 and dashes, up to 40.',
    ]);
    expect(
      says((b) => Object.assign(station(b, "book"), { template: "post", platform: "linkedin" })),
    ).toEqual([]);
  });
});

describe("checkMetro: tracks", () => {
  const add = (t: MetroTrack) => (b: MetroBody) => b.tracks.push(t);

  it("wants both ends to exist and to differ", () => {
    expect(
      says(add({ id: "t1", from: "ghost", to: "prep", line: "growth", by: "system" })),
    ).toEqual(['Track "t1" names station "ghost", which is not in the shape.']);
    expect(
      says(add({ id: "t1", from: "prep", to: "ghost", line: "growth", by: "system" })),
    ).toEqual(['Track "t1" names station "ghost", which is not in the shape.']);
    expect(says(add({ id: "t1", from: "prep", to: "prep", line: "growth", by: "system" }))).toEqual(
      ['Track "t1" starts and ends at "prep".'],
    );
  });

  it("wants a known kind and a known by", () => {
    expect(says((b) => (track(b, "reply_to_qualify").kind = "side" as never))).toEqual([
      'Track "reply_to_qualify" has kind "side". Use exit, xfer, back, or none.',
    ]);
    expect(says((b) => (track(b, "reply_to_qualify").by = "robot" as never))).toEqual([
      'Track "reply_to_qualify" has by "robot". Use system or person.',
    ]);
  });

  it("allows owner and promise on a person track only", () => {
    expect(says((b) => (track(b, "reply_to_qualify").owner = "Sam"))).toEqual([
      'Track "reply_to_qualify" has an owner but is moved by the system.',
    ]);
    expect(says((b) => (track(b, "reply_to_qualify").promise = "1d"))).toEqual([
      'Track "reply_to_qualify" has a promise but is moved by the system.',
    ]);
    expect(says((b) => (track(b, "proposal_to_signed").owner = ""))).toEqual([
      'Track "proposal_to_signed" has an empty owner.',
    ]);
    expect(says((b) => (track(b, "proposal_to_signed").owner = "x".repeat(41)))).toEqual([
      'Track "proposal_to_signed" has an owner longer than 40 characters.',
    ]);
    expect(says((b) => (track(b, "proposal_to_signed").owner = "x".repeat(40)))).toEqual([]);
  });

  it("wants a promise and a wait to be a duration", () => {
    for (const bad of ["2 days", "d", "10", "1w", "-1d", "1.5h"]) {
      expect(says((b) => (track(b, "proposal_to_signed").promise = bad))).toEqual([
        `Track "proposal_to_signed" has promise "${bad}". Use a number and m, h or d, as 30m, 4h or 2d.`,
      ]);
    }
    for (const ok of ["30m", "4h", "2d", "0d"]) {
      expect(says((b) => (track(b, "proposal_to_signed").promise = ok))).toEqual([]);
    }
    expect(says((b) => (track(b, "wait_to_gone").wait = "soon"))).toEqual([
      'Track "wait_to_gone" has wait "soon". Use a number and m, h or d, as 30m, 4h or 2d.',
    ]);
  });

  it("wants a plain track to name a line that exists", () => {
    expect(says((b) => delete track(b, "reply_to_qualify").line)).toEqual([
      'Track "reply_to_qualify" needs a line.',
    ]);
    expect(says((b) => (track(b, "reply_to_qualify").line = "ghost"))).toEqual([
      'Track "reply_to_qualify" is on line "ghost", which does not exist.',
    ]);
  });

  it("sends an exit track to an exit station", () => {
    expect(says((b) => (track(b, "pay_to_done").to = "onboard"))).toEqual([
      'Track "pay_to_done" is an exit track, so it must end at an exit station.',
    ]);
  });

  it("joins two lines with a transfer, on the line of its end station", () => {
    expect(says((b) => (track(b, "pay_to_retain").line = "growth"))).toEqual([
      'Transfer "pay_to_retain" must be on the line of its end station "retain_start" ("retain").',
    ]);
    expect(
      says((b) => {
        const t = track(b, "reply_to_qualify");
        t.kind = "xfer";
      }),
    ).toEqual(['Transfer "reply_to_qualify" must join stations on different lines.']);
    expect(
      says((b) => {
        const t = track(b, "pay_to_retain");
        t.from = "done";
      }),
    ).toContain('Transfer "pay_to_retain" must join two stations that are on lines.');
  });

  it("lets nothing leave an exit station", () => {
    expect(
      says(add({ id: "out_of_gone", from: "gone", to: "held", line: "growth", by: "system" })),
    ).toContain('Track "out_of_gone" leaves exit "gone". An exit ends the path.');
  });
});

describe("checkMetro: logic stations", () => {
  const without =
    (...ids: string[]) =>
    (b: MetroBody) => {
      b.tracks = b.tracks.filter((t) => !ids.includes(t.id));
    };
  const BRANCHES = (kind: string, id: string) => `${kind} "${id}"`;

  it("wants a condition with 2 or 3 branches", () => {
    expect(says(without("qualify_to_fork", "qualify_to_book"))).toEqual([
      'Condition "qualify" needs 2 or 3 branches, not 1.',
    ]);
    expect(
      says((b) =>
        b.tracks.push({
          id: "extra_branch",
          from: "qualify",
          to: "prep",
          line: "growth",
          by: "system",
          cond: "other",
        }),
      ),
    ).toEqual(['Condition "qualify" needs 2 or 3 branches, not 4.']);
  });

  it("wants a condition to have exactly one else, and a cond of 4 words or fewer on the rest", () => {
    expect(says((b) => (track(b, "qualify_to_fork").else = true))).toEqual([
      'Condition "qualify" needs exactly one else branch.',
    ]);
    expect(says((b) => delete track(b, "qualify_to_test").else)).toEqual([
      'Condition "qualify" needs exactly one else branch.',
      'Branch "qualify_to_test" of condition "qualify" needs a cond of 4 words or fewer.',
    ]);
    const long =
      'Branch "qualify_to_book" of condition "qualify" needs a cond of 4 words or fewer.';
    expect(says((b) => (track(b, "qualify_to_book").cond = "one two three four five"))).toEqual([
      long,
    ]);
    expect(says((b) => delete track(b, "qualify_to_book").cond)).toEqual([long]);
    expect(says((b) => (track(b, "qualify_to_book").cond = "one two three four"))).toEqual([]);
  });

  it("wants a race with 2 or more branches, one with a wait, the rest with a cond", () => {
    expect(says(without("wait_to_held"))).toEqual(['Race "wait" needs 2 or more branches, not 1.']);
    expect(says((b) => delete track(b, "wait_to_gone").wait)).toEqual([
      'Race "wait" needs exactly one branch with a wait.',
      'Branch "wait_to_gone" of race "wait" needs a cond of 4 words or fewer.',
    ]);
    expect(says((b) => (track(b, "wait_to_held").wait = "1d"))).toEqual([
      'Race "wait" needs exactly one branch with a wait.',
    ]);
    expect(says((b) => delete track(b, "wait_to_held").cond)).toEqual([
      'Branch "wait_to_held" of race "wait" needs a cond of 4 words or fewer.',
    ]);
  });

  it("wants a split with 2 or more branches", () => {
    expect(says(without("fork_to_docs"))).toEqual([
      'Split "fork" needs 2 or more branches, not 1.',
    ]);
  });

  it("wants a join with 2 or more tracks in and a rule of all, any or n of m", () => {
    expect(says(without("docs_to_merge"))).toEqual([
      'Join "merge" needs 2 or more tracks into it, not 1.',
    ]);
    const rule = 'Join "merge" needs a rule: all, any, or "<n> of <m>" as "2 of 3".';
    for (const bad of ["some", "", "0 of 2", "2 of", "2of2"]) {
      expect(says((b) => (station(b, "merge").rule = bad))).toEqual([rule]);
    }
    expect(says((b) => delete station(b, "merge").rule)).toEqual([rule]);
    for (const ok of ["all", "any", "1 of 2", "2 of 2"]) {
      expect(says((b) => (station(b, "merge").rule = ok))).toEqual([]);
    }
    for (const bad of ["1 of 3", "3 of 2"]) {
      expect(says((b) => (station(b, "merge").rule = bad))).toEqual([
        `Join "merge" has rule "${bad}". It needs m to equal its 2 tracks in, and n from 1 to m.`,
      ]);
    }
  });

  it("wants an A/B with 2 or more arms, each a weight from 1 to 99, adding up to 100", () => {
    expect(says(without("test_to_b"))).toEqual([
      'A/B "test" needs 2 or more arms, not 1.',
      'The arms of A/B "test" add up to 60. They must add up to 100.',
    ]);
    expect(says((b) => (track(b, "test_to_b").weight = 30))).toEqual([
      'The arms of A/B "test" add up to 90. They must add up to 100.',
    ]);
    const arm = 'Arm "test_to_b" of A/B "test" needs a weight, a whole percent from 1 to 99.';
    for (const weight of [0, 100, 1.5]) {
      const e = says((b) => (track(b, "test_to_b").weight = weight));
      expect(e[0]).toBe(arm);
    }
    const e = says((b) => delete track(b, "test_to_b").weight);
    expect(e).toEqual([arm, 'The arms of A/B "test" add up to 60. They must add up to 100.']);
  });

  it("allows cond, else, wait and weight only on the out-tracks of their own stations", () => {
    expect(says((b) => (track(b, "reply_to_qualify").cond = "x"))).toEqual([
      'Track "reply_to_qualify" has a cond, but "reply" is not a condition or a race.',
    ]);
    expect(says((b) => (track(b, "wait_to_held").else = true))).toEqual([
      'Track "wait_to_held" is an else branch, but "wait" is not a condition.',
    ]);
    expect(says((b) => (track(b, "reply_to_qualify").wait = "1d"))).toEqual([
      'Track "reply_to_qualify" has a wait, but "reply" is not a race.',
    ]);
    expect(says((b) => (track(b, "qualify_to_book").wait = "1d"))).toEqual([
      'Track "qualify_to_book" has a wait, but "qualify" is not a race.',
    ]);
    expect(says((b) => (track(b, "reply_to_qualify").weight = 5))).toEqual([
      'Track "reply_to_qualify" has a weight, but "reply" is not an A/B.',
    ]);
    expect(BRANCHES("Race", "wait")).toBe('Race "wait"');
  });
});

describe("checkMetro: order", () => {
  it("refuses a loop of plain and transfer tracks", () => {
    const e = says((b) =>
      b.tracks.push({
        id: "merge_to_fork",
        from: "merge",
        to: "fork",
        line: "growth",
        by: "system",
      }),
    );
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^Tracks form a loop: .*fork.*merge.* Make one of them a back track\.$/);
  });

  it("lets a back track close a loop and run left", () => {
    expect(
      says((b) =>
        b.tracks.push({ id: "again", from: "merge", to: "fork", kind: "back", by: "person" }),
      ),
    ).toEqual([]);
    expect(
      says((b) =>
        b.tracks.push({ id: "restart", from: "pay", to: "reply", kind: "back", by: "person" }),
      ),
    ).toEqual([]);
  });

  it("never lets a plain or transfer track go left", () => {
    const side =
      (over: Partial<MetroStation> = {}) =>
      (b: MetroBody) => {
        b.stations.push(extra({ id: "side", column: "marketing", ...over }));
      };
    expect(
      says((b) => {
        side()(b);
        b.tracks.push({
          id: "signed_to_side",
          from: "signed",
          to: "side",
          line: "growth",
          by: "system",
        });
      }),
    ).toEqual(['Track "signed_to_side" goes from sales to marketing. A track never goes left.']);
    expect(
      says((b) => {
        side({ line: "nurture" })(b);
        b.tracks.push({
          id: "retain_to_side",
          from: "retain_start",
          to: "side",
          line: "nurture",
          kind: "xfer",
          by: "system",
        });
      }),
    ).toEqual(['Track "retain_to_side" goes from money to marketing. A track never goes left.']);
  });
});

describe("checkMetro: groups", () => {
  const closing = (b: MetroBody) => {
    const g = b.groups[0];
    if (!g) throw new Error("no group");
    return g;
  };

  it("wants a label, a line that exists and at least one station", () => {
    expect(says((b) => (closing(b).label = ""))).toEqual(['Group "closing" needs a label.']);
    expect(says((b) => (closing(b).stations = []))).toEqual([
      'Group "closing" needs at least one station or a group inside it.',
    ]);
    const e = says((b) => (closing(b).line = "ghost"));
    expect(e).toContain('Group "closing" is on line "ghost", which does not exist.');
  });

  it("wants each station to exist and sit on the group's line", () => {
    expect(says((b) => (closing(b).stations = ["proposal", "ghost"]))).toEqual([
      'Group "closing" names station "ghost", which is not in the shape.',
    ]);
    expect(says((b) => (closing(b).stations = ["proposal", "retain_start"]))).toEqual([
      'Group "closing" holds station "retain_start", which is not on line "growth".',
    ]);
  });

  it("nests groups to any depth: a group of groups needs no line and no station", () => {
    expect(
      says((b) => {
        closing(b).parent = "sales";
        b.groups.push({ id: "sales", label: "Sales", stations: [], parent: "business" });
        b.groups.push({ id: "business", label: "Business", stations: [] });
      }),
    ).toEqual([]);
  });

  it("wants a parent that exists, and no group inside itself", () => {
    expect(says((b) => (closing(b).parent = "ghost"))).toEqual([
      'Group "closing" sits in group "ghost", which does not exist.',
    ]);
    const e = says((b) => {
      closing(b).parent = "sales";
      b.groups.push({ id: "sales", label: "Sales", stations: [], parent: "closing" });
    });
    expect(e).toContain('Group "closing" sits inside itself through "sales".');
    expect(e).toContain('Group "sales" sits inside itself through "closing".');
  });

  it("never holds an exit, and holds the hub like any station", () => {
    expect(says((b) => closing(b).stations.push("gone"))).toEqual([
      'Group "closing" holds exit "gone". An exit folds with its source.',
    ]);
    expect(says((b) => closing(b).stations.push("hub"))).toEqual([]);
    expect(says((b) => b.groups.push({ id: "front", label: "Front", stations: ["hub"] }))).toEqual(
      [],
    );
  });

  it("puts no station in two groups", () => {
    expect(
      says((b) =>
        b.groups.push({ id: "other", label: "Other", line: "growth", stations: ["signed"] }),
      ),
    ).toEqual(['Station "signed" is in two groups: "closing" and "other".']);
  });
});

describe("checkMetro: frames", () => {
  const stop = (b: MetroBody) => {
    const f = b.frames[0];
    if (!f) throw new Error("no frame");
    return f;
  };

  it("wants at least one station, and every station to exist", () => {
    expect(says((b) => (stop(b).stations = []))).toEqual([
      'Frame "stop" needs at least one station.',
    ]);
    expect(says((b) => (stop(b).stations = ["pitch_a", "ghost"]))).toEqual([
      'Frame "stop" names station "ghost", which is not in the shape.',
    ]);
  });

  it("wants a known trigger and an exit station to send people to", () => {
    expect(says((b) => (stop(b).trigger = { trigger: "trigger.nope" }))).toEqual([
      'Frame "stop" uses "trigger.nope", which is not a known trigger.',
    ]);
    expect(says((b) => (stop(b).exit = "held"))).toEqual([
      'Frame "stop" sends people to "held", which is not an exit station.',
    ]);
    expect(says((b) => (stop(b).exit = "ghost"))).toEqual([
      'Frame "stop" sends people to "ghost", which is not an exit station.',
    ]);
  });
});

describe("checkMetro: attach", () => {
  const growth = (b: MetroBody) => b.lines.find((l) => l.id === "growth") as MetroBody["lines"][0];
  /** The reasons when the first line of the body holds exactly `attach`. */
  const withAttach = (attach: unknown): string[] =>
    says((b) => (growth(b).attach = attach as Attach[]));

  it("holds every attach kind in the fixture, and passes", () => {
    const b = metroShape();
    const kinds = new Set(
      [
        ...b.lines.flatMap((l) => l.attach ?? []),
        ...b.stations.flatMap((s) => s.attach ?? []),
        ...b.groups.flatMap((g) => g.attach ?? []),
      ].map((a) => a.kind),
    );
    expect(kinds).toEqual(new Set(ATTACH_KINDS));
    expect(checkMetro(b, ctx())).toEqual([]);
  });

  it("takes an id or an https URL, and an empty list", () => {
    expect(
      withAttach([
        { kind: "sop", ref: "growth-playbook" },
        { kind: "template", ref: "recruiting-sms#1" },
        { kind: "doc", ref: "https://docs.example.com/d/1?x=y#top", label: "Plan" },
        { kind: "note", ref: "8b0e6a52-3f1c-4d5e-9a77-1c2d3e4f5a6b" },
        { kind: "link", ref: "https://example.com" },
      ]),
    ).toEqual([]);
    expect(withAttach([])).toEqual([]);
  });

  it("wants a known kind", () => {
    expect(withAttach([{ kind: "wiki", ref: "x" }])).toEqual([
      'Line "growth" attach 1 has kind "wiki". Use sop, link, page, funnel, doc, template, note.',
    ]);
    expect(withAttach([{ ref: "x" }])).toEqual([
      'Line "growth" attach 1 has kind "undefined". Use sop, link, page, funnel, doc, template, note.',
    ]);
  });

  it("wants a ref of 1 to 500 characters with no spaces", () => {
    const need = 'Line "growth" attach 1 needs a ref of 1 to 500 characters.';
    expect(withAttach([{ kind: "sop", ref: "" }])).toEqual([need]);
    expect(withAttach([{ kind: "sop" }])).toEqual([need]);
    expect(withAttach([{ kind: "sop", ref: 7 }])).toEqual([need]);
    expect(withAttach([{ kind: "sop", ref: "a".repeat(500) }])).toEqual([]);
    expect(withAttach([{ kind: "sop", ref: "a".repeat(501) }])).toEqual([need]);
    expect(withAttach([{ kind: "sop", ref: "two words" }])).toEqual([
      'Line "growth" attach 1 has a ref with a space in it.',
    ]);
    expect(withAttach([{ kind: "sop", ref: "tab\there" }])).toEqual([
      'Line "growth" attach 1 has a ref with a space in it.',
    ]);
  });

  it("takes no other scheme than https, and wants a link to be a URL", () => {
    for (const ref of ["http://example.com", "javascript:alert(1)", "mailto:a@b.co", "ftp://x"]) {
      expect(withAttach([{ kind: "doc", ref }])).toEqual([
        `Line "growth" attach 1 has ref "${ref}". Use an id or an https:// URL.`,
      ]);
    }
    expect(withAttach([{ kind: "link", ref: "example.com" }])).toEqual([
      'Line "growth" attach 1 is a link, so its ref must be an https:// URL.',
    ]);
  });

  it("wants a label of 80 characters at most", () => {
    expect(withAttach([{ kind: "sop", ref: "x", label: "a".repeat(80) }])).toEqual([]);
    expect(withAttach([{ kind: "sop", ref: "x", label: "a".repeat(81) }])).toEqual([
      'Line "growth" attach 1 has a label longer than 80 characters.',
    ]);
    expect(withAttach([{ kind: "sop", ref: "x", label: 5 }])).toEqual([
      'Line "growth" attach 1 has a label longer than 80 characters.',
    ]);
  });

  it("numbers the items, and reports each fault", () => {
    expect(
      withAttach([
        { kind: "sop", ref: "ok" },
        { kind: "nope", ref: "a b" },
      ]),
    ).toEqual([
      'Line "growth" attach 2 has kind "nope". Use sop, link, page, funnel, doc, template, note.',
      'Line "growth" attach 2 has a ref with a space in it.',
    ]);
  });

  it("wants a list of maps", () => {
    expect(withAttach("sop:x")).toEqual(['Line "growth" needs an attach list.']);
    expect(withAttach([null])).toEqual(['Line "growth" attach 1 needs a kind and a ref.']);
  });

  it("checks stations, groups and the stations of a flow the same way", () => {
    const bad = [{ kind: "wiki", ref: "x" }] as unknown as Attach[];
    const why = (name: string) =>
      `${name} attach 1 has kind "wiki". Use sop, link, page, funnel, doc, template, note.`;
    expect(says((b) => (station(b, "reply").attach = bad))).toEqual([why('Station "reply"')]);
    expect(
      says((b) => {
        const g = b.groups[0];
        if (g) g.attach = bad;
      }),
    ).toEqual([why('Group "closing"')]);
    expect(
      says((b) => {
        const s = b.flows?.[0]?.stations[0];
        if (s) s.attach = bad;
      }),
    ).toEqual([`Flow "shared_followup": ${why('Station "nudge"')}`]);
  });
});

describe("checkMetro: flows", () => {
  const followup = (b: MetroBody): MetroFlow => {
    const f = b.flows?.find((x) => x.id === "shared_followup");
    if (!f) throw new Error("no flow shared_followup");
    return f;
  };
  /** A second flow `other` of two stations, as a shared flow would be. */
  const other = (over: Partial<MetroFlow> = {}): MetroFlow => ({
    id: "other",
    label: "Other flow",
    stations: [
      { id: "one", label: "One", kind: "att", line: "growth", column: "sales", action: "other" },
      { id: "two", label: "Two", kind: "att", line: "growth", column: "sales", action: "other" },
    ],
    tracks: [{ id: "one_to_two", from: "one", to: "two", line: "growth", by: "system" }],
    ...over,
  });
  const link = (id: string, flow: string): MetroStation => ({
    id,
    label: id,
    kind: "link",
    line: "growth",
    column: "delivery",
    flow,
  });

  it("passes a body with no flows key, or an empty list, when no station links", () => {
    const unlink = (b: MetroBody) => {
      station(b, "shared").kind = "att";
      delete station(b, "shared").flow;
      station(b, "shared").action = "other";
    };
    expect(
      says((b) => {
        unlink(b);
        delete b.flows;
      }),
    ).toEqual([]);
    expect(
      says((b) => {
        unlink(b);
        b.flows = [];
      }),
    ).toEqual([]);
  });

  it("wants a flow for every link, so a body with no flows cannot link", () => {
    expect(says((b) => delete b.flows)).toEqual([
      'Link "shared" names flow "shared_followup", which is not in the shape.',
    ]);
    expect(says((b) => (b.flows = []))).toEqual([
      'Link "shared" names flow "shared_followup", which is not in the shape.',
    ]);
  });

  it("wants flow ids in the id rule, unique, and a label", () => {
    expect(says((b) => (followup(b).id = "Bad Flow"))).toEqual([
      'Flow id "Bad Flow" must be lowercase letters, digits and underscores, starting with a letter.',
      'Link "shared" names flow "shared_followup", which is not in the shape.',
    ]);
    expect(says((b) => b.flows?.push(other({ id: "shared_followup" })))).toEqual([
      'Flow id "shared_followup" is used twice.',
    ]);
    expect(says((b) => (followup(b).label = " "))).toEqual([
      'Flow "shared_followup": It needs a label.',
    ]);
  });

  it("keeps the ids of a flow to the flow: the body and other flows may reuse them", () => {
    expect(
      says((b) => {
        const { attach: _attach, ...reply } = station(b, "reply");
        followup(b).stations.push(reply);
        b.flows?.push(other({ stations: followup(b).stations.map((s) => ({ ...s })), tracks: [] }));
      }),
    ).toEqual([]);
    expect(
      says((b) => followup(b).tracks.push({ ...(followup(b).tracks[0] as MetroTrack) })),
    ).toEqual(['Flow "shared_followup": Track id "nudge_to_check_in" is used twice.']);
    expect(
      says((b) => followup(b).stations.push({ ...(followup(b).stations[0] as MetroStation) })),
    ).toEqual(['Flow "shared_followup": Station id "nudge" is used twice.']);
  });

  it("holds no hub, and keeps the reserved ids", () => {
    expect(
      says((b) =>
        followup(b).stations.push({ id: "hub", label: "Hub", kind: "hub", column: "marketing" }),
      ),
    ).toEqual(['Flow "shared_followup": Station "hub" is a hub. A flow holds no hub.']);
    expect(says((b) => followup(b).stations.push(extra({ id: "hub" })))).toEqual([
      'Flow "shared_followup": Station id "hub" is reserved for the hub station.',
    ]);
    expect(says((b) => followup(b).stations.push(extra({ id: "dropped" })))).toEqual([
      'Flow "shared_followup": Station id "dropped" is reserved for dropped journeys.',
    ]);
  });

  it("runs the station rules inside a flow, and names the flow", () => {
    expect(says((b) => ((followup(b).stations[0] as MetroStation).idleDays = 0))).toEqual([
      'Flow "shared_followup": Station "nudge" has idleDays 0. Use a whole number of days from 1 to 365.',
    ]);
    expect(says((b) => ((followup(b).stations[0] as MetroStation).line = "ghost"))).toEqual([
      'Flow "shared_followup": Station "nudge" is on line "ghost", which does not exist.',
    ]);
    expect(says((b) => followup(b).stations.push(extra({ column: "nowhere" as never })))).toEqual([
      'Flow "shared_followup": Station "extra" has column "nowhere". Use marketing, sales, delivery, money.',
    ]);
  });

  it("lets a flow have no lines, because a shared flow belongs to no line", () => {
    const noLines = (b: MetroBody) => {
      const f = followup(b);
      f.stations = f.stations.map(({ line: _line, ...rest }) => rest);
      f.tracks = f.tracks.map(({ line: _line, ...rest }) => rest);
    };
    expect(says(noLines)).toEqual([]);
    // The body keeps its rule: a station and a track still need a line there.
    expect(
      says((b) => {
        delete station(b, "reply").line;
      }),
    ).toContain('Station "reply" needs a line.');
  });

  it("wants a line a flow names to be a line of the body", () => {
    expect(says((b) => ((followup(b).tracks[0] as MetroTrack).line = "ghost"))).toEqual([
      'Flow "shared_followup": Track "nudge_to_check_in" is on line "ghost", which does not exist.',
    ]);
    expect(
      says((b) => {
        const f = followup(b);
        f.stations = f.stations.map(({ line: _line, ...rest }) => rest);
        f.tracks = f.tracks.map(({ line: _line, ...rest }) => rest);
        (f.stations[1] as MetroStation).line = "ghost";
      }),
    ).toEqual([
      'Flow "shared_followup": Station "check_in" is on line "ghost", which does not exist.',
    ]);
  });

  it("runs the track rules inside a flow", () => {
    expect(says((b) => ((followup(b).tracks[0] as MetroTrack).to = "ghost"))).toEqual([
      'Flow "shared_followup": Track "nudge_to_check_in" names station "ghost", which is not in the shape.',
    ]);
    expect(says((b) => ((followup(b).tracks[0] as MetroTrack).by = "robot" as never))).toEqual([
      'Flow "shared_followup": Track "nudge_to_check_in" has by "robot". Use system or person.',
    ]);
    expect(
      says((b) =>
        followup(b).tracks.push({
          id: "up",
          from: "check_in",
          to: "nudge",
          line: "growth",
          by: "system",
        }),
      ),
    ).toEqual([
      'Flow "shared_followup": Tracks form a loop: nudge -> check_in -> nudge. Make one of them a back track.',
    ]);
  });

  it("runs the branch rules inside a flow", () => {
    expect(
      says((b) => {
        const f = followup(b);
        f.stations.push({
          id: "fit",
          label: "Fit?",
          kind: "condition",
          line: "growth",
          column: "delivery",
        });
        f.tracks.push({
          id: "check_in_to_fit",
          from: "check_in",
          to: "fit",
          line: "growth",
          by: "system",
        });
        f.tracks.push({
          id: "fit_to_nudge",
          from: "fit",
          to: "nudge",
          line: "growth",
          by: "system",
          else: true,
        });
      }),
    ).toContain('Flow "shared_followup": Condition "fit" needs 2 or 3 branches, not 1.');
  });

  it("runs the order rule inside a flow: a track never goes left", () => {
    expect(
      says((b) => {
        const f = followup(b);
        (f.stations[0] as MetroStation).column = "money";
      }),
    ).toEqual([
      'Flow "shared_followup": Track "nudge_to_check_in" goes from money to delivery. A track never goes left.',
    ]);
  });

  it("takes no entries in a flow, because it has no hub", () => {
    expect(says((b) => ((followup(b).tracks[0] as MetroTrack).entries = ["social"]))).toEqual([
      'Flow "shared_followup": Track "nudge_to_check_in" has entries but does not leave the hub.',
    ]);
  });

  it("wants a link of the body to name a flow of the body", () => {
    expect(says((b) => (station(b, "shared").flow = "ghost"))).toEqual([
      'Link "shared" names flow "ghost", which is not in the shape.',
    ]);
    expect(says((b) => b.flows?.push(other()))).toEqual([]);
    expect(says((b) => (station(b, "shared").flow = "other"))).toEqual([
      'Link "shared" names flow "other", which is not in the shape.',
    ]);
  });

  it("lets a flow link to another flow", () => {
    expect(
      says((b) => {
        b.flows?.push(other());
        followup(b).stations.push(link("more", "other"));
        followup(b).tracks.push({
          id: "check_in_to_more",
          from: "check_in",
          to: "more",
          line: "growth",
          by: "system",
        });
      }),
    ).toEqual([]);
  });

  it("wants a link inside a flow to name a flow of the body", () => {
    expect(says((b) => followup(b).stations.push(link("more", "ghost")))).toEqual([
      'Flow "shared_followup": Link "more" names flow "ghost", which is not in the shape.',
    ]);
  });

  it("refuses a flow that links to itself", () => {
    expect(says((b) => followup(b).stations.push(link("again", "shared_followup")))).toEqual([
      'Flow "shared_followup": Link "again" names this flow. A flow does not link to itself.',
    ]);
  });

  it("refuses links that loop", () => {
    const loop = (b: MetroBody) => {
      b.flows?.push(other({ stations: [...other().stations, link("back", "shared_followup")] }));
      followup(b).stations.push(link("onward", "other"));
    };
    expect(says(loop)).toEqual([
      "Flows link in a loop: shared_followup -> other -> shared_followup.",
    ]);
    // Three flows in a ring.
    expect(
      says((b) => {
        b.flows?.push(
          other({ stations: [...other().stations, link("l2", "third")] }),
          other({ id: "third", stations: [...other().stations, link("l3", "shared_followup")] }),
        );
        followup(b).stations.push(link("l1", "other"));
      }),
    ).toEqual(["Flows link in a loop: shared_followup -> other -> third -> shared_followup."]);
    // Two links down a chain, and two links to one flow, are not a loop.
    expect(
      says((b) => {
        b.flows?.push(
          other({ stations: [...other().stations, link("a", "third"), link("b", "third")] }),
          other({ id: "third" }),
        );
        followup(b).stations.push(link("c", "other"), link("d", "other"));
      }),
    ).toEqual([]);
  });

  it("wants flows to be a list", () => {
    expect(says((b) => (b.flows = {} as never))).toEqual(["flows is a list of flows."]);
  });

  it("reports a fault in a flow next to a fault in the body", () => {
    const b = metroShape();
    station(b, "reply").idleDays = 0;
    followup(b).label = "";
    expect(checkMetro(b, ctx())).toEqual([
      'Station "reply" has idleDays 0. Use a whole number of days from 1 to 365.',
      'Flow "shared_followup": It needs a label.',
    ]);
  });
});

describe("checkMetro: every reason at once", () => {
  it("returns each fault found, and changes nothing", () => {
    const b = metroShape();
    b.name = "";
    station(b, "reply").idleDays = 0;
    track(b, "book_to_wait").by = "robot" as never;
    const before = JSON.stringify(b);
    const e = checkMetro(b, ctx());
    expect(JSON.stringify(b)).toBe(before);
    expect(e).toEqual([
      "The shape needs a name.",
      'Station "reply" has idleDays 0. Use a whole number of days from 1 to 365.',
      'Track "book_to_wait" has by "robot". Use system or person.',
    ]);
  });
});
