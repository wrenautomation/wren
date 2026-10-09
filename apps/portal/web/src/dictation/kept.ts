/**
 * Model files from the network, kept in Cache Storage: onnxruntime's wasm (gzipped, from our own
 * origin) for dictation and reading aloud, and reading's voices.
 */
/** The file, unzipped when it came gzipped and nothing on the way already did. */
export async function unzip(res: Response): Promise<ArrayBuffer> {
  const raw = await res.arrayBuffer();
  const head = new Uint8Array(raw, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(out).arrayBuffer();
}

/** A file kept in Cache Storage `cache` after the first fetch, as it came (gzipped). */
export async function kept(url: string, cache: string): Promise<ArrayBuffer> {
  try {
    const box = await caches.open(cache);
    const hit = await box.match(url);
    if (hit) return await unzip(hit);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    await box.put(url, res.clone());
    return await unzip(res);
  } catch (err) {
    if (err instanceof Error && /^\d{3} for /.test(err.message)) throw err;
    // No Cache Storage (a private window): fetch it plain.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return await unzip(res);
  }
}
