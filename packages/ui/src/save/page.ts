/**
 * Every box a page holds (a record's words, fields, slides, a video's finish): `flush` saves
 * each dirty one, then answers. A head action (Approve, Schedule, Post now) flushes the page
 * first, so it never acts on words still in a box.
 */
export interface Flushable {
  flush: () => Promise<boolean>;
}

export class SavePage {
  private readonly boxes = new Set<Flushable>();

  /** A box opened on the page; the answer takes it off. */
  add(box: Flushable): () => void {
    this.boxes.add(box);
    return () => void this.boxes.delete(box);
  }

  /** Save every box now, together. True once the server holds them all; false if any failed or conflicts. */
  async flush(): Promise<boolean> {
    const all = await Promise.all([...this.boxes].map((b) => b.flush().catch(() => false)));
    return all.every(Boolean);
  }

  get size() {
    return this.boxes.size;
  }
}
