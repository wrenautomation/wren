/**
 * Tiny HTML reading: visible text, links, title, mailto/tel hrefs in one pass.
 * Deliberately not a DOM: enrichment needs the words and the links, not the tree,
 * and a tolerant tokenizer never chokes on the malformed markup small-business
 * sites actually serve. Never throws: a pathological page degrades to whatever was
 * read so far, never sinks a crawl.
 */

const SKIP_CONTENT: ReadonlySet<string> = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
]);
/** Raw-text elements: their content holds no tags to parse. */
const RAW_TEXT: ReadonlySet<string> = new Set(["script", "style"]);
/** Elements that end a run of inline text; a newline keeps extracted text readable. */
const BLOCK: ReadonlySet<string> = new Set([
  "p",
  "div",
  "br",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
]);

export interface PageLink {
  url: string;
  anchor: string;
}

export interface PageContent {
  title: string;
  text: string;
  /** Absolute url + anchor text; mailto/tel/javascript/fragment hrefs excluded. */
  links: PageLink[];
  /** Addresses declared in mailto: hrefs, decoded, query-stripped, order kept, duplicates kept. */
  mailtos: string[];
  tels: string[];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  deg: "°",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  aacute: "á",
  ccedil: "ç",
  ntilde: "ñ",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  szlig: "ß",
  euro: "€",
  pound: "£",
  times: "×",
};

/** Decode numeric and common named character references. Unknown names are left as-is. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

function parseAttrs(s: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of s.matchAll(re)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (!attrs.has(name)) attrs.set(name, decodeEntities(value));
  }
  return attrs;
}

/** Absolute URL for a link, or the raw href when neither it nor the base parses. */
function joinUrl(base: string, href: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href;
  if (!base) return href;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

class Extractor {
  readonly parts: string[] = [];
  readonly links: PageLink[] = [];
  readonly mailtos: string[] = [];
  readonly tels: string[] = [];
  title = "";
  private skipDepth = 0;
  private inTitle = false;
  private href: string | null = null;
  private anchorParts: string[] = [];

  constructor(private readonly baseUrl: string) {}

  startTag(tag: string, attrs: Map<string, string>): void {
    if (SKIP_CONTENT.has(tag)) this.skipDepth++;
    else if (tag === "title") this.inTitle = true;
    else if (tag === "a") {
      const href = attrs.get("href");
      if (href?.startsWith("mailto:")) {
        const list = safeDecode(href.slice(7).split("?", 1)[0] ?? "");
        for (const addr of list.split(",")) {
          const clean = addr.trim();
          if (clean) this.mailtos.push(clean);
        }
      } else if (href?.startsWith("tel:")) {
        const number = href.slice(4).trim();
        if (number) this.tels.push(safeDecode(number));
      } else if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
        this.href = joinUrl(this.baseUrl, href);
        this.anchorParts = [];
      }
    }
    if (BLOCK.has(tag)) this.parts.push("\n");
  }

  endTag(tag: string): void {
    if (SKIP_CONTENT.has(tag) && this.skipDepth) this.skipDepth--;
    else if (tag === "title") this.inTitle = false;
    else if (tag === "a" && this.href) {
      this.links.push({
        url: this.href,
        anchor: this.anchorParts.join("").split(/\s+/).filter(Boolean).join(" "),
      });
      this.href = null;
    }
    if (BLOCK.has(tag)) this.parts.push("\n");
  }

  data(raw: string): void {
    const text = decodeEntities(raw);
    // Title first: <title> sits inside <head>, which is otherwise a skipped container.
    if (this.inTitle) {
      this.title += text;
      return;
    }
    if (this.skipDepth) return;
    this.parts.push(text);
    if (this.href !== null) this.anchorParts.push(text);
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Feed `html` through the extractor. Tolerant: unterminated constructs end at EOF. */
function tokenize(html: string, out: Extractor): void {
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.data(html.slice(i));
      return;
    }
    if (lt > i) out.data(html.slice(i, lt));
    const rest = html.slice(lt, lt + 4);
    if (rest.startsWith("<!--")) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (rest.startsWith("<!") || rest.startsWith("<?")) {
      const end = html.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) {
      out.data("<");
      i = lt + 1;
      continue;
    }
    const closing = m[1] === "/";
    const tag = (m[2] ?? "").toLowerCase();
    const end = findTagEnd(html, lt + m[0].length);
    const inside = html.slice(lt + m[0].length, end < 0 ? n : end);
    i = end < 0 ? n : end + 1;
    if (closing) {
      out.endTag(tag);
      continue;
    }
    const selfClosing = /\/\s*$/.test(inside);
    out.startTag(tag, parseAttrs(selfClosing ? inside.replace(/\/\s*$/, "") : inside));
    if (selfClosing) {
      out.endTag(tag);
      continue;
    }
    if (RAW_TEXT.has(tag)) {
      const close = html.slice(i).search(new RegExp(`</${tag}\\s*>`, "i"));
      if (close < 0) {
        out.data(html.slice(i));
        return;
      }
      out.data(html.slice(i, i + close));
      i += close;
      const closeEnd = html.indexOf(">", i);
      i = closeEnd < 0 ? n : closeEnd + 1;
      out.endTag(tag);
    }
  }
}

/** Index of the `>` closing a tag whose name ends at `from`, honoring quoted attribute values. */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

export function readPage(html: string, baseUrl = ""): PageContent {
  const out = new Extractor(baseUrl);
  try {
    tokenize(html, out);
  } catch {
    // degrade to whatever was extracted so far
  }
  const text = out.parts
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return {
    title: out.title.split(/\s+/).filter(Boolean).join(" "),
    text,
    links: out.links,
    mailtos: out.mailtos,
    tels: out.tels,
  };
}

/** SPA mount-point / framework markers, checked against lowercased markup. */
const SHELL_MARKERS = [
  'id="root"',
  "id='root'",
  'id="app"',
  "id='app'",
  'id="__next"',
  "__next_data__",
  "data-reactroot",
  'id="___gatsby"',
  "ng-version=",
  'id="q-app"',
  "enable javascript",
  "requires javascript",
] as const;
const SHELL_MAX_TEXT = 200;
const SHELL_MIN_HTML = 2000;

/**
 * Is this page a JS mount point whose words live client-side? Thin text alone must
 * NOT fire (a tiny server-rendered contact page is real content): a shell is thin
 * text plus substantial, script-dominated markup or a framework mount marker.
 */
export function looksLikeJsShell(html: string, text: string): boolean {
  if (text.trim().length >= SHELL_MAX_TEXT) return false;
  if (html.length < SHELL_MIN_HTML) return false;
  const lowered = html.toLowerCase();
  if (SHELL_MARKERS.some((marker) => lowered.includes(marker))) return true;
  return lowered.split("<script").length - 1 >= 3;
}
