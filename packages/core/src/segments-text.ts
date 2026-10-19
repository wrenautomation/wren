/**
 * A group's rule as text (designs/2026-10-15-channel-stats.md), for agents and the CLI. It reads
 * and writes the same `Rule` the portal edits as JSON:
 *
 *   all(
 *     trait stage is "cold",
 *     trait persona is "agency owner",
 *     step saw on reddit in 30d,
 *     not message opened on email
 *   )
 *
 * - Nesting: `all(...)`, `any(...)`; items split by commas or new lines; `not` before any item;
 *   `#` starts a comment.
 * - `trait <key> is|contains|one_of|>|<|exists|before|after|in_next|in_last [value]`
 * - `event <kind> [on <channel>] [matching "<text>"] [count] [in <n>d] [after <kind> [on <ch>]]
 *   [before <kind> [on <ch>]]`
 * - `message <state> [on <channel>] [campaign "<text>"] [count] [in <n>d]`
 * - `step <reached|saw|engaged|replied|booked|paid> [on <channel>] [source "<text>"] [in <n>d]`
 * - `journey [at|reached <node>] [open|done|dropped] [entry <id>] [opened] [in <n>d]`:
 *   a journey at that node (`reached` = the node is on its trail or where it sits), opened by
 *   that source; the days count back from its last move, or from `opened`. Every part is
 *   optional. Older text said `funnel <id>`: it still reads, and the funnel is ignored.
 * - `consent <email|sms> <state>`; `group <id>` or `group "<name>"` (`segment` reads the same: older saved text).
 * - A count is `>= N`, `<= N`, `N..M` or `never`; left out, it's at least once.
 *
 * Pure: the portal shows it too.
 */
import { FUNNEL_STEPS } from "./channel-stats-schema.js";
import { TIMELINE_KINDS } from "./profiles-schema.js";
import {
  type Anchor,
  CONSENT_CHANNELS,
  CONSENT_CONDITION_STATES,
  type Condition,
  JOURNEY_STATUS_NAMES,
  type JourneyCondition,
  MESSAGE_STATES,
  type Node,
  type Rule,
  readRule,
  TRAIT_OPS,
} from "./segments.js";

const OPS: Readonly<Record<string, string>> = { ">": "gt", "<": "lt", gt: "gt", lt: "lt" };
const OP_TEXT: Readonly<Record<string, string>> = { gt: ">", lt: "<" };

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function countText(least: number, most: number | undefined): string {
  if (most === undefined) return least === 1 ? "" : ` >= ${least}`;
  if (most === 0) return " never";
  return least === 0 ? ` <= ${most}` : ` ${least}..${most}`;
}
const daysText = (d: number | null | undefined) => (d ? ` in ${d}d` : "");
const onText = (ch: string | undefined) => (ch && ch !== "any" ? ` on ${ch}` : "");
const anchorText = (w: string, a: Anchor | undefined) =>
  a ? ` ${w} ${a.event}${onText(a.channel)}` : "";

function journeyText(c: JourneyCondition): string {
  const parts = ["journey"];
  if (c.node) parts.push(c.reached ? "reached" : "at", c.node);
  if (c.status) parts.push(c.status);
  if (c.entry) parts.push("entry", c.entry);
  if (c.days) parts.push(...(c.window === "opened" ? ["opened"] : []), "in", `${c.days}d`);
  return parts.join(" ");
}

function conditionText(c: Condition, names: ReadonlyMap<number, string>): string {
  switch (c.kind) {
    case "trait": {
      const op = OP_TEXT[c.op] ?? c.op;
      if (c.op === "exists") return `trait ${c.key} exists`;
      const v = typeof c.value === "number" ? String(c.value) : quote(String(c.value ?? ""));
      return `trait ${c.key} ${op} ${v}`;
    }
    case "event":
      return `event ${c.event}${onText(c.channel)}${c.match ? ` matching ${quote(c.match)}` : ""}${countText(c.atLeast, c.atMost)}${daysText(c.days)}${anchorText("after", c.after)}${anchorText("before", c.before)}`;
    case "message":
      return `message ${c.state}${onText(c.channel)}${c.campaign ? ` campaign ${quote(c.campaign)}` : ""}${countText(c.atLeast, c.atMost)}${daysText(c.days)}`;
    case "step":
      return `step ${c.step}${onText(c.channel)}${c.source ? ` source ${quote(c.source)}` : ""}${daysText(c.days)}`;
    case "journey":
      return journeyText(c);
    case "consent":
      return `consent ${c.channel} ${c.state}`;
    case "segment": {
      const name = names.get(c.segment);
      return `group ${name ? quote(name) : c.segment}`;
    }
  }
}

function nodeText(n: Node, names: ReadonlyMap<number, string>, pad: string): string {
  const not = n.not ? "not " : "";
  if (n.kind !== "group") return `${not}${conditionText(n, names)}`;
  const inner = n.of.map((c) => nodeText(c, names, `${pad}  `));
  const flat = `${not}${n.match}(${inner.join(", ")})`;
  if (flat.length + pad.length <= 80 && !flat.includes("\n")) return flat;
  return `${not}${n.match}(\n${inner.map((i) => `${pad}  ${i}`).join(",\n")}\n${pad})`;
}

/** A rule as text. `names` prints a group condition by its group's name. */
export function ruleText(rule: Rule, names: ReadonlyMap<number, string> = new Map()): string {
  return nodeText(rule, names, "");
}

// ---------------------------------------------------------------------------------------------
// Reading

type Token =
  | { t: "word"; v: string; at: number }
  | { t: "text"; v: string; at: number }
  | { t: "punct"; v: string; at: number };

class TextProblem extends Error {}

function tokens(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === '"') {
      let v = "";
      const at = i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) i++;
        v += src[i++];
      }
      if (src[i] !== '"') throw new TextProblem(`a quote opened at ${at + 1} never closes`);
      i++;
      out.push({ t: "text", v, at });
    } else if ("(),".includes(ch)) {
      out.push({ t: "punct", v: ch, at: i++ });
    } else if (ch === ">" || ch === "<") {
      const two = src[i + 1] === "=";
      out.push({ t: "punct", v: two ? `${ch}=` : ch, at: i });
      i += two ? 2 : 1;
    } else {
      const at = i;
      while (i < src.length && !/[\s(),"#<>]/.test(src[i] as string)) i++;
      out.push({ t: "word", v: src.slice(at, i), at });
    }
  }
  return out;
}

class Reader {
  i = 0;
  constructor(
    readonly ts: Token[],
    readonly names: ReadonlyMap<string, number>,
  ) {}
  peek(): Token | undefined {
    return this.ts[this.i];
  }
  next(what: string): Token {
    const t = this.ts[this.i++];
    if (!t) throw new TextProblem(`expected ${what}, but the text ended`);
    return t;
  }
  word(what: string): string {
    const t = this.next(what);
    if (t.t !== "word") throw new TextProblem(`expected ${what} at ${t.at + 1}, got "${t.v}"`);
    return t.v;
  }
  text(what: string): string {
    const t = this.next(what);
    if (t.t === "punct") throw new TextProblem(`expected ${what} at ${t.at + 1}, got "${t.v}"`);
    return t.v;
  }
  /** The next word, taken only when it's `w`. */
  is(w: string): boolean {
    const t = this.peek();
    if (t && t.t !== "text" && t.v === w) {
      this.i++;
      return true;
    }
    return false;
  }
  /** The next word, one of `list`. */
  pick(what: string, list: readonly string[]): string {
    const t = this.next(what);
    const v = t.t === "text" ? t.v : (OPS[t.v] ?? t.v);
    if (!list.includes(v))
      throw new TextProblem(`"${t.v}" at ${t.at + 1} isn't ${what}: ${list.join(", ")}`);
    return v;
  }
  number(what: string): number {
    const v = this.word(what);
    if (!/^\d+$/.test(v)) throw new TextProblem(`expected ${what}, got "${v}"`);
    return Number(v);
  }

  node(): Node {
    const not = this.is("not");
    const head = this.word("all(, any( or a condition");
    let n: Node;
    if ((head === "all" || head === "any") && this.peek()?.v === "(") {
      this.i++;
      const of: Node[] = [];
      while (this.peek()?.v !== ")") {
        of.push(this.node());
        if (this.peek()?.v === ",") this.i++;
        else if (this.peek()?.v !== ")") this.next(`"," or ")"`);
      }
      this.i++;
      n = { kind: "group", match: head, of };
    } else n = this.condition(head);
    return not ? { ...n, not: true } : n;
  }

  condition(head: string): Condition {
    switch (head) {
      case "trait": {
        const key = this.word("a trait key");
        const op = this.pick("a trait test", [...Object.keys(TRAIT_OPS), ">", "<"]);
        if (op === "exists") return { kind: "trait", key, op } as Condition;
        const t = this.next("a value");
        if (t.t === "punct") throw new TextProblem(`expected a value at ${t.at + 1}`);
        const value = t.t === "word" && /^-?\d+(\.\d+)?$/.test(t.v) ? Number(t.v) : t.v;
        return { kind: "trait", key, op, value } as Condition;
      }
      case "event": {
        const c: Record<string, unknown> = {
          kind: "event",
          event: this.pick("a timeline kind", TIMELINE_KINDS),
        };
        if (this.is("on")) c.channel = this.word("a channel");
        if (this.is("matching")) c.match = this.text("words to match");
        Object.assign(c, this.count());
        const days = this.days();
        if (days) c.days = days;
        if (this.is("after")) c.after = this.anchor();
        if (this.is("before")) c.before = this.anchor();
        return c as Condition;
      }
      case "message": {
        const c: Record<string, unknown> = {
          kind: "message",
          state: this.pick("a message state", Object.keys(MESSAGE_STATES)),
        };
        if (this.is("on")) c.channel = this.word("a channel");
        if (this.is("campaign")) c.campaign = this.text("campaign words");
        Object.assign(c, this.count());
        const days = this.days();
        if (days) c.days = days;
        return c as Condition;
      }
      case "step": {
        const c: Record<string, unknown> = {
          kind: "step",
          step: this.pick("a funnel step", FUNNEL_STEPS),
        };
        if (this.is("on")) c.channel = this.word("a channel");
        if (this.is("source")) c.source = this.text("source words");
        const days = this.days();
        if (days) c.days = days;
        return c as Condition;
      }
      case "journey": {
        const c: Record<string, unknown> = { kind: "journey" };
        for (;;) {
          // Older text named a funnel: read it, keep nothing.
          if (this.is("funnel")) this.word("a funnel id");
          else if (this.is("at")) c.node = this.word("a node id");
          else if (this.is("reached")) {
            c.node = this.word("a node id");
            c.reached = true;
          } else if (this.is("entry")) c.entry = this.word("a source id");
          else if (this.is("opened")) c.window = "opened";
          else {
            const t = this.peek();
            const status =
              t?.t === "word" ? JOURNEY_STATUS_NAMES.find((x) => x === t.v) : undefined;
            if (!status) break;
            this.i++;
            c.status = status;
          }
        }
        const days = this.days();
        if (days) c.days = days;
        return c as Condition;
      }
      case "consent":
        return {
          kind: "consent",
          channel: this.pick("a consent channel", CONSENT_CHANNELS),
          state: this.pick("a consent state", CONSENT_CONDITION_STATES),
        } as Condition;
      case "group":
      case "segment": {
        const t = this.next("a group id or name");
        if (t.t === "word" && /^\d+$/.test(t.v)) return { kind: "segment", segment: Number(t.v) };
        const id = this.names.get(t.v.toLowerCase());
        if (!id) throw new TextProblem(`no group called "${t.v}"`);
        return { kind: "segment", segment: id };
      }
      default:
        throw new TextProblem(
          `"${head}" isn't a condition: trait, event, message, step, journey, consent or group`,
        );
    }
  }

  count(): { atLeast?: number; atMost?: number } {
    if (this.is("never")) return { atLeast: 0, atMost: 0 };
    if (this.is(">=")) return { atLeast: this.number("a count") };
    if (this.is("<=")) return { atLeast: 0, atMost: this.number("a count") };
    const t = this.peek();
    const range = t?.t === "word" ? /^(\d+)\.\.(\d+)$/.exec(t.v) : null;
    if (range) {
      this.i++;
      return { atLeast: Number(range[1]), atMost: Number(range[2]) };
    }
    return {};
  }

  days(): number | null {
    if (!this.is("in")) return null;
    const v = this.word("days, like 30d");
    const m = /^(\d+)d$/.exec(v);
    if (!m) throw new TextProblem(`expected days like 30d, got "${v}"`);
    return Number(m[1]);
  }

  anchor(): Anchor {
    const a: Record<string, unknown> = { event: this.pick("a timeline kind", TIMELINE_KINDS) };
    if (this.is("on")) a.channel = this.word("a channel");
    return a as Anchor;
  }
}

/**
 * Text read into a rule, checked as a saved rule is; or why not, as readable lines. `names` maps a
 * group's name (any case) to its id, for `group "<name>"`. One condition alone is `all(it)`.
 */
export function parseRule(
  src: string,
  names: ReadonlyMap<string, number> = new Map(),
): { rule: Rule } | { problems: string[] } {
  let node: Node;
  try {
    const ts = tokens(src);
    if (!ts.length) return { problems: ["the rule is empty"] };
    const lower = new Map([...names].map(([k, v]) => [k.toLowerCase(), v]));
    const r = new Reader(ts, lower);
    node = r.node();
    const rest = r.peek();
    if (rest) throw new TextProblem(`unexpected "${rest.v}" at ${rest.at + 1}`);
  } catch (e) {
    if (e instanceof TextProblem) return { problems: [e.message] };
    throw e;
  }
  return readRule(node.kind === "group" ? node : { kind: "group", match: "all", of: [node] });
}
