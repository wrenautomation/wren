/**
 * Python `repr()` parity for the template version hash.
 *
 * `Template.version` in the Python port is `sha256(repr((subject, body)))[:12]` over a
 * projection of tuples, strings and None. Stored `messages.template_version` and
 * `template_versions.version` rows must keep matching after the port, so the hash input is
 * rebuilt byte-for-byte here: same quote choice, same escapes, same tuple punctuation.
 */

/** The projection value space: str | None | tuple[...]. */
export type PyValue = string | null | readonly PyValue[];

// str.isprintable() is false for Cc, Cf, Cs, Co, Cn, Zl, Zp, Zs — except U+0020.
const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");

/** `repr(str)`: Python's quote selection and escaping rules. */
export function pyReprStr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${hex(cp, 2)}`;
    else if (cp < 0x7f) out += ch;
    else if (cp === 0x20 || !NOT_PRINTABLE.test(ch)) out += ch;
    else if (cp <= 0xff) out += `\\x${hex(cp, 2)}`;
    else if (cp <= 0xffff) out += `\\u${hex(cp, 4)}`;
    else out += `\\U${hex(cp, 8)}`;
  }
  return out + quote;
}

/** `repr()` of a str / None / (nested) tuple value. */
export function pyRepr(value: PyValue): string {
  if (value === null) return "None";
  if (typeof value === "string") return pyReprStr(value);
  if (value.length === 0) return "()";
  if (value.length === 1) return `(${pyRepr(value[0] as PyValue)},)`;
  return `(${value.map(pyRepr).join(", ")})`;
}
