/**
 * The SEC's daily firm feed (full Part 1A as XML for every registered firm) as
 * import rows. It carries `<WebAddrs>`, ALL website addresses, where the monthly
 * roster keeps only the first-listed one: harvesting it is the cheapest domain win,
 * and it runs as a plain company import (keyed matching, blank-only domain attach,
 * DOMAIN_CHANGED/CONFLICT records, sightings all come from the generic importer).
 *
 * Dialect (verified against IA_FIRM_SEC_Feed_08_28_2026):
 * - Attribute-based XML, ISO-8859-1, ~17k <Firm> elements under <Firms>.
 * - Identity: Info/@FirmCrdNb -> "crd:{n}", minted into the IDENTITY_KEY channel.
 * - The roster-dialect fact keys ('5F(2)(c)', '5A', '5D(a)(1)' …) are prepended,
 *   mapped from the feed's attribute names (Item5F/@Q5F2C …), so firm_facts keeps
 *   reading one vocabulary whichever source spoke last.
 * - Website: the first WebAddr that yields a non-platform domain; all addresses ride
 *   in raw.WebAddrs regardless.
 *
 * Streamed: the 78 MB file is never held whole. The gzip stream feeds a SAX parser
 * and each <Firm> subtree is built, emitted and dropped.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import {
  extractDomain,
  IDENTITY_KEY,
  isPlatformDomain,
  type LeadSource,
  normalizeCountry,
  type RawRow,
} from "@wren/core";
import { SaxesParser, type SaxesTagPlain } from "saxes";

/** Feed attribute -> roster-dialect fact key (the firm_facts vocabulary). */
const FACT_MAP: readonly (readonly [element: string, attribute: string, fact: string])[] = [
  ["Item5F", "Q5F2C", "5F(2)(c)"], // regulatory AUM
  ["Item5A", "TtlEmp", "5A"], // employees
  ["Item5D", "Q5DA1", "5D(a)(1)"], // individual clients
  ["Item5D", "Q5DB1", "5D(b)(1)"], // high-net-worth clients
  ["Item5D", "Q5DF1", "5D(f)(1)"], // pooled-vehicle clients
];

/** One parsed XML element: enough of the tree for a Firm. */
export interface XmlElement {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlElement[];
}

export class SecFirmFeedSource implements LeadSource {
  readonly sourceType = "sec-firm-feed";
  readonly sourceRef: string;
  readonly contentHash: string;

  constructor(readonly path: string) {
    this.sourceRef = path;
    this.contentHash = createHash("sha256").update(readFileSync(path)).digest("hex");
  }

  async *rows(): AsyncGenerator<RawRow> {
    for await (const firm of firmElements(this.path)) {
      const row = firmRow(firm);
      if (row !== null) yield row;
    }
  }
}

/**
 * Every <Firm> element in the (possibly gzipped) feed, one at a time. The SAX parser
 * runs chunk by chunk; firms completed in a chunk are yielded before the next chunk
 * is read, so memory holds one chunk's worth of firms at most.
 */
export async function* firmElements(path: string): AsyncGenerator<XmlElement> {
  const parser = new SaxesParser();
  const stack: XmlElement[] = [];
  let done: XmlElement[] = [];
  let failure: Error | null = null;
  parser.on("error", (err) => {
    failure = err;
  });
  parser.on("opentag", (tag: SaxesTagPlain) => {
    const element: XmlElement = {
      tag: tag.name,
      attributes: { ...tag.attributes },
      text: "",
      children: [],
    };
    if (stack.length > 0 || tag.name === "Firm") stack.push(element);
    if (stack.length > 1) (stack[stack.length - 2] as XmlElement).children.push(element);
  });
  parser.on("text", (text: string) => {
    const top = stack.at(-1);
    if (top) top.text += text;
  });
  parser.on("closetag", (tag: SaxesTagPlain) => {
    if (stack.length === 0) return;
    const element = stack.pop() as XmlElement;
    if (stack.length === 0 && tag.name === "Firm") done.push(element);
  });

  const raw = createReadStream(path);
  const stream = path.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  const decoder = new TextDecoder("latin1");
  for await (const chunk of stream) {
    parser.write(decoder.decode(chunk as Uint8Array, { stream: true }));
    if (failure) throw failure;
    if (done.length > 0) {
      const batch = done;
      done = [];
      yield* batch;
    }
  }
  parser.close();
  if (failure) throw failure;
  yield* done;
}

const find = (element: XmlElement, tag: string) => element.children.find((c) => c.tag === tag);
function* descendants(element: XmlElement): Generator<XmlElement> {
  for (const child of element.children) {
    yield child;
    yield* descendants(child);
  }
}

export function firmRow(firm: XmlElement): RawRow | null {
  const info = find(firm, "Info");
  if (info === undefined) return null;
  const crd = (info.attributes.FirmCrdNb ?? "").trim();
  if (!crd) return null; // nothing any later phase could find it by again

  const raw = flatten(firm);
  const webAddrs = [...descendants(firm)]
    .filter((e) => e.tag === "WebAddr")
    .map((e) => e.text.trim())
    .filter(Boolean);
  if (webAddrs.length > 0) raw.WebAddrs = webAddrs;

  const main = find(firm, "MainAddr")?.attributes ?? {};
  const city = (main.City ?? "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const state = (main.State ?? "").trim();
  return {
    // Canonical prepends win in canonicalize's first pass.
    company_name: (info.attributes.BusNm ?? info.attributes.LegalNm ?? "").trim(),
    website: primaryWebsite(webAddrs),
    geo: [city, state].filter(Boolean).join(", "),
    country: normalizeCountry((main.Cntry ?? "").trim()) ?? "",
    ...factsOf(firm),
    ...raw,
    // Minted last: no XML attribute (always a string) can shadow the identity object.
    [IDENTITY_KEY]: { source_key: `crd:${crd}` },
  };
}

/** First address naming a real (non-platform) domain; else the first address (kept as social_url); else "". */
function primaryWebsite(webAddrs: readonly string[]): string {
  for (const address of webAddrs) {
    const domain = extractDomain(address);
    if (domain && !isPlatformDomain(domain)) return address;
  }
  return webAddrs[0] ?? "";
}

/** Only asserted attributes are written: an absent attribute stays an absent key. First asserted value wins. */
function factsOf(firm: XmlElement): Record<string, string> {
  const facts: Record<string, string> = {};
  const all = [...descendants(firm)];
  for (const [tag, attribute, fact] of FACT_MAP) {
    for (const element of all) {
      if (element.tag !== tag) continue;
      const value = element.attributes[attribute]?.trim();
      if (value) {
        facts[fact] = value;
        break;
      }
    }
  }
  return facts;
}

/**
 * Every attribute in the subtree as 'Path.To.Element.attr' keys. Repeated sibling
 * paths get __2/__3 suffixes (same discipline as duplicate CSV headers) so raw
 * provenance never silently last-wins.
 */
function flatten(firm: XmlElement): RawRow {
  const flat: RawRow = {};
  const seen = new Map<string, number>();
  const walk = (element: XmlElement, path: string) => {
    for (const [attribute, value] of Object.entries(element.attributes)) {
      const base = path ? `${path}.${attribute}` : attribute;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      flat[n === 1 ? base : `${base}__${n}`] = value;
    }
    for (const child of element.children) walk(child, path ? `${path}.${child.tag}` : child.tag);
  };
  for (const child of firm.children) walk(child, child.tag);
  return flat;
}
