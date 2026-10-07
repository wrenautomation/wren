/**
 * Cut streamed text into sentences, so the first one goes to the mouth before the reply ends.
 * A sentence ends at . ! or ? followed by a space; a decimal ("3.5"), an initial ("J. Smith" is
 * still cut, which is fine to say) and an abbreviation like "Dr." stay whole.
 */
const KEEP = /\b(?:mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|a\.m|p\.m)\.$/i;

export class SentenceCutter {
  private rest = "";

  /** Feed a chunk; get back the sentences it completed. */
  push(chunk: string): string[] {
    this.rest += chunk;
    const out: string[] = [];
    let from = 0;
    for (let i = 0; i < this.rest.length - 1; i++) {
      const c = this.rest[i] as string;
      if ((c === "." || c === "!" || c === "?") && /\s/.test(this.rest[i + 1] as string)) {
        const s = this.rest.slice(from, i + 1).trim();
        if (c === "." && KEEP.test(s)) continue;
        if (s) out.push(s);
        from = i + 1;
      }
    }
    this.rest = this.rest.slice(from);
    return out;
  }

  /** What's left once the stream ends. */
  flush(): string | null {
    const s = this.rest.trim();
    this.rest = "";
    return s || null;
  }
}
