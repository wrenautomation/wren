/**
 * The template authoring format: a file IS the email.
 *
 *     subject: [[Quick question | A question]] about {company_name}
 *
 *     Hi {first_name|there},
 *
 *     ((Saw you work with {company.segment} clients — ))worth a look?
 *
 * Four marks, nothing else:
 * - `{key}` fills a fact; missing -> the draft is refused (never "Hi ,").
 * - `{key|fallback}` renders the fallback when the fact is missing (`{key|}` renders nothing).
 * - `[[a | b | c]]` is a variant point, auto-named v1, v2, ... in document order.
 *   `[[#hook a | b]]` names it (a lowercase name, then a space): the name is its locus key
 *   for experiments, and it stays put when points are added before it.
 * - `((...))` is an optional segment: vanishes when a fact inside is missing.
 * - `<<prompt>>` is a prompt slot: a model writes it from the prompt (which may quote
 *   `{key}` facts), checked before render; missing like a `{key}` when it can't be filled.
 * - `{{` is a literal `{` (a prompt quoting JSON); a lone `}` is always literal.
 *
 * A file without a leading `subject:` line is a thread-riding follow-up. A line starting
 * with `##` is a comment, stripped before parsing. A line opening with `# ` (or a lone `#`)
 * is refused as a probable mistyped comment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pyReprStr } from "./pyrepr.js";
import {
  type Block,
  type FieldBlock,
  field,
  group,
  slot,
  type Template,
  type TextBlock,
  template,
  text,
  type VariantsBlock,
  variants,
} from "./tree.js";

/** A template file that cannot mean what it says — refused at load, naming template and line. */
export class AuthoringError extends Error {
  override readonly name = "AuthoringError";
}

const FIELD_NAME = /^[A-Za-z0-9_.]+$/;
const SUBJECT_NEAR_MISS = /^\s*subject\s*:/i;
const BOM = "﻿";

/** Python `str.strip()`/`lstrip()`/`rstrip()` over a character set (default: whitespace). */
const lstrip = (s: string, chars?: string) =>
  chars === undefined ? s.replace(/^\s+/, "") : s.replace(new RegExp(`^[${chars}]+`), "");
const rstrip = (s: string, chars?: string) =>
  chars === undefined ? s.replace(/\s+$/, "") : s.replace(new RegExp(`[${chars}]+$`), "");
const strip = (s: string, chars?: string) => rstrip(lstrip(s, chars), chars);
const countNewlines = (s: string, from = 0, to = s.length) => {
  let n = 0;
  for (let i = s.indexOf("\n", from); i !== -1 && i < to; i = s.indexOf("\n", i + 1)) n++;
  return n;
};

function stripComments(name: string, source: string): { text: string; lineMap: number[] } {
  const kept: string[] = [];
  const lineMap: number[] = [];
  source.split("\n").forEach((line, i) => {
    const lineno = i + 1;
    if (line.startsWith("##")) return;
    if (line === "#" || line.startsWith("# ")) {
      throw new AuthoringError(
        `${name}:${lineno}: this line looks like a comment, but comments open` +
          " with ## — double the hash, or rephrase if it is email copy",
      );
    }
    kept.push(line);
    lineMap.push(lineno);
  });
  return { text: kept.join("\n"), lineMap };
}

/**
 * Every *.email file in the directory becomes a template named by its filename stem, and
 * every *.email file one directory down is named `<arm>/<stem>`. One level only.
 */
export function loadTemplates(directory: string): Map<string, Template> {
  let isDir = false;
  try {
    isDir = statSync(directory).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new Error(`template directory ${directory} does not exist`);
  const subdirs = readdirSync(directory, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const arm of subdirs) {
    for (const deeper of readdirSync(join(directory, arm), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()) {
      const files = readdirSync(join(directory, arm, deeper))
        .filter((f) => f.endsWith(".email"))
        .sort();
      if (files[0] !== undefined) {
        throw new AuthoringError(
          `${arm}/${deeper}/${files[0]}: one level of arm directories only` +
            " — a template is <name>.email or <arm>/<name>.email",
        );
      }
    }
  }
  const emailFiles = (dir: string) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".email"))
      .map((d) => d.name)
      .sort();
  const rel: string[] = emailFiles(directory);
  for (const arm of subdirs)
    rel.push(...emailFiles(join(directory, arm)).map((f) => `${arm}/${f}`));
  const templates = new Map<string, Template>();
  for (const path of rel) {
    const name = path.slice(0, -".email".length);
    if (name.length > 64) {
      throw new AuthoringError(`${name}: template name longer than 64 characters`);
    }
    // A leading BOM is stripped transparently; any BOM left over (mid-file) would
    // otherwise render silently into the email body.
    let source = readFileSync(join(directory, path), "utf8");
    if (source.startsWith(BOM)) source = source.slice(1);
    const bom = source.indexOf(BOM);
    if (bom !== -1) {
      const line = countNewlines(source.slice(0, bom)) + 1;
      throw new AuthoringError(
        `${name}:${line}: a byte-order-mark here would render into the email body`,
      );
    }
    templates.set(name, parseTemplate(name, source));
  }
  return templates;
}

type LineOf = (line: number) => number;
interface Counter {
  n: number;
}

export function parseTemplate(name: string, rawSource: string): Template {
  const { text: source, lineMap } = stripComments(name, rawSource);
  const lineOf: LineOf = (line) =>
    0 < line && line <= lineMap.length ? (lineMap[line - 1] as number) : line;
  const counter: Counter = { n: 0 };
  let index = 0;
  while (index < source.length && source[index] === "\n") index++;
  let subject: Block[] | null = null;
  if (source.slice(index, index + 8).toLowerCase() === "subject:") {
    let lineEnd = source.indexOf("\n", index);
    if (lineEnd === -1) lineEnd = source.length;
    const baseLine = countNewlines(source.slice(0, index)) + 1;
    subject = parse(strip(source.slice(index + 8, lineEnd)), name, baseLine, counter, lineOf, {
      allowGroup: true,
      allowVariant: true,
    });
    if (subject.length === 0) {
      throw new AuthoringError(
        `${name}:${lineOf(baseLine)}: subject: line is empty — delete the line to ride the thread`,
      );
    }
    index = lineEnd + 1;
  } else {
    refuseNearMissSubject(source, index, name, lineOf);
  }
  const bodySrc = source.slice(index);
  const leadNewlines = bodySrc.length - lstrip(bodySrc, "\\n").length;
  const bodyLine = countNewlines(source.slice(0, index)) + 1 + leadNewlines;
  const body = parse(rstrip(strip(bodySrc, "\\n")), name, bodyLine, counter, lineOf, {
    allowGroup: true,
    allowVariant: true,
  });
  if (body.length === 0) throw new AuthoringError(`${name}: the file has no body`);
  return template(name, subject, body);
}

/**
 * A body alone: no subject line, no comments, its spacing kept as written. A text, a DM and a
 * prompt parse this way, with the same marks as an email.
 */
export function parseBody(name: string, source: string): Template {
  const body = parse(source, name, 1, { n: 0 }, (line) => line, {
    allowGroup: true,
    allowVariant: true,
  });
  if (body.length === 0) throw new AuthoringError(`${name}: the template is empty`);
  return template(name, null, body);
}

function refuseNearMissSubject(source: string, index: number, name: string, lineOf: LineOf) {
  let lineEnd = source.indexOf("\n", index);
  if (lineEnd === -1) lineEnd = source.length;
  const firstLine = source.slice(index, lineEnd);
  if (SUBJECT_NEAR_MISS.test(firstLine)) {
    const line = lineOf(countNewlines(source.slice(0, index)) + 1);
    throw new AuthoringError(
      `${name}:${line}: this line looks like a subject header but isn't the exact form —` +
        ' use "subject:" at the very start of the line, no leading space,' +
        " no space before the colon",
    );
  }
}

interface ParseOptions {
  allowGroup: boolean;
  allowVariant: boolean;
}

function parse(
  src: string,
  name: string,
  baseLine: number,
  counter: Counter,
  lineOf: LineOf,
  opts: ParseOptions,
): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  // Lines counted forward from the last block, not from the top each time.
  let counted = 0;
  let line = baseLine;
  while (i < src.length) {
    const found = (["((", "[[", "<<", "{"] as const)
      .map((token) => ({ pos: src.indexOf(token, i), token }))
      .filter((f) => f.pos !== -1)
      .sort((a, b) => a.pos - b.pos);
    const hit = found[0];
    if (hit === undefined) {
      appendText(blocks, src.slice(i));
      break;
    }
    const { pos, token } = hit;
    appendText(blocks, src.slice(i, pos));
    line += countNewlines(src, counted, pos);
    counted = pos;
    if (token === "<<") {
      const end = src.indexOf(">>", pos);
      if (end === -1) throw new AuthoringError(`${name}:${lineOf(line)}: unclosed << >>`);
      const prompt = strip(src.slice(pos + 2, end));
      if (!prompt) throw new AuthoringError(`${name}:${lineOf(line)}: empty << >> prompt`);
      blocks.push(slot(prompt));
      i = end + 2;
    } else if (token === "{" && src[pos + 1] === "{") {
      appendText(blocks, "{");
      i = pos + 2;
    } else if (token === "{") {
      const end = src.indexOf("}", pos);
      if (end === -1) throw new AuthoringError(`${name}:${lineOf(line)}: unclosed { }`);
      blocks.push(parseField(src.slice(pos + 1, end), name, lineOf(line)));
      i = end + 1;
    } else if (token === "[[") {
      if (!opts.allowVariant) {
        throw new AuthoringError(`${name}:${lineOf(line)}: a [[ ]] cannot open here — no nesting`);
      }
      const end = src.indexOf("]]", pos);
      if (end === -1) throw new AuthoringError(`${name}:${lineOf(line)}: unclosed [[ ]]`);
      blocks.push(parseVariant(src.slice(pos + 2, end), name, line, counter, lineOf));
      i = end + 2;
    } else {
      if (!opts.allowGroup) {
        throw new AuthoringError(`${name}:${lineOf(line)}: a (( )) cannot open here — no nesting`);
      }
      const end = findGroupEnd(src, pos + 2);
      if (end === -1) throw new AuthoringError(`${name}:${lineOf(line)}: unclosed (( ))`);
      const inner = parse(src.slice(pos + 2, end), name, line, counter, lineOf, {
        allowGroup: false,
        allowVariant: true,
      });
      if (!inner.some((b) => b.kind === "field" || b.kind === "variants")) {
        throw new AuthoringError(
          `${name}:${lineOf(line)}: (( )) contains no {fact} or [[variants]] — it` +
            " could never be absent; drop the parentheses",
        );
      }
      blocks.push(group(inner as (TextBlock | FieldBlock | VariantsBlock)[]));
      i = end + 2;
    }
  }
  return blocks;
}

/** The `))` closing a group, tracking single-paren depth so an authored "(aside)" survives. */
function findGroupEnd(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    if (depth === 0 && src.slice(i, i + 2) === "))") return i;
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && depth > 0) depth--;
    i++;
  }
  return -1;
}

/** Text joins the text before it, so an escaped `{` never splits a run. */
function appendText(blocks: Block[], value: string): void {
  if (!value) return;
  const last = blocks.at(-1);
  if (last?.kind === "text") blocks[blocks.length - 1] = text(last.text + value);
  else blocks.push(text(value));
}

function parseField(content: string, name: string, line: number): FieldBlock {
  const bar = content.indexOf("|");
  const rawKey = bar === -1 ? content : content.slice(0, bar);
  const key = strip(rawKey);
  if (!key || !FIELD_NAME.test(key)) {
    throw new AuthoringError(
      `${name}:${line}: bad fact name ${pyReprStr(key)} in { } — letters, digits, dot, underscore`,
    );
  }
  return field(key, bar === -1 ? null : strip(content.slice(bar + 1)));
}

function parseVariant(
  content: string,
  name: string,
  line: number,
  counter: Counter,
  lineOf: LineOf,
): VariantsBlock {
  counter.n += 1;
  let locus: string | null = null;
  let list = content;
  if (content.startsWith("#")) {
    const m = /^#([a-z][a-z0-9_]*) /.exec(content);
    if (!m) {
      throw new AuthoringError(
        `${name}:${lineOf(line)}: a named point is [[#name a | b]]: a lowercase name, then a space`,
      );
    }
    locus = m[1] as string;
    list = content.slice(m[0].length);
  }
  const options: (TextBlock | FieldBlock)[][] = [];
  for (const raw of splitOptions(list)) {
    const option = strip(raw);
    if (!option) {
      throw new AuthoringError(
        `${name}:${lineOf(line)}: empty option in [[ ]] — remove the stray |`,
      );
    }
    options.push(
      parse(option, name, line, counter, lineOf, { allowGroup: false, allowVariant: false }) as (
        | TextBlock
        | FieldBlock
      )[],
    );
  }
  return locus === null
    ? variants(`v${counter.n}`, options)
    : variants(locus, options, undefined, true);
}

/** Split on | at the top level only — a | inside {key|fallback} or <<prompt>> belongs to it. */
function splitOptions(content: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let prompt = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i] as string;
    const pair = content.slice(i, i + 2);
    if (pair === "<<") prompt = true;
    else if (pair === ">>") prompt = false;
    if (pair === "{{") {
      current += pair;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "|" && depth === 0 && !prompt) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * The inverse of parseTemplate: the minimal authoring text that reparses to an equal
 * template. `nameAll` writes every point's name (`[[#v1 ...]]`), so its locus keeps its key.
 */
export function toSource(tpl: Template, opts: { nameAll?: boolean } = {}): string {
  const all = opts.nameAll ?? false;
  let source = "";
  if (tpl.subject !== null) source += `subject: ${sourceBlocks(tpl.subject, all)}\n\n`;
  source += sourceBlocks(tpl.body, all);
  return source.endsWith("\n") ? source : `${source}\n`;
}

const sourceBlocks = (blocks: readonly Block[], all: boolean): string =>
  blocks.map((b) => sourceBlock(b, all)).join("");

function sourceBlock(block: Block, all: boolean): string {
  switch (block.kind) {
    case "text":
      return block.text.replaceAll("{", "{{");
    case "field":
      if (block.prompt !== undefined) return `<<${block.prompt}>>`;
      return block.fallback === null ? `{${block.key}}` : `{${block.key}|${block.fallback}}`;
    case "variants":
      return `[[${block.named || all ? `#${block.name} ` : ""}${block.options
        .map((o) => sourceBlocks(o, all))
        .join(" | ")}]]`;
    case "group":
      return `((${sourceBlocks(block.blocks, all)}))`;
  }
}
