/**
 * Spoken commands in dictated words: "new line" is a line break, "period" a full stop. Nothing
 * fancier. The model writes the commands as words with its own commas around them ("attached,
 * new line, talk soon period."), so the commas go too.
 */

const NEW_LINE = /[ \t]*[,.;:]?[ \t]*\bnew[ -]?line\b[,.;:!?]?[ \t]*/gi;
const PERIOD = /[ \t]*[,;:]?[ \t]*\bperiod\b[.,;:!?]?/gi;

/** `text` with its spoken commands turned into what they say. */
export function applyCommands(text: string): string {
  let out = text.replace(NEW_LINE, "\n").replace(PERIOD, ".");
  // A full stop the model also wrote: one is enough.
  out = out.replace(/\.(\s*[.,])+/g, ".");
  // A new sentence after a full stop or a line break starts with a capital.
  out = out.replace(/([.!?]\s+|\n)(\p{Ll})/gu, (_, before, c) => before + c.toUpperCase());
  return out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ");
}
