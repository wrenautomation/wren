/**
 * Run `work` over `items` with at most `width` at once, in item order. A worker
 * stops taking new items once `stopped()` says so; items already started finish.
 * Probes are seconds of waiting on someone else's mail server, so the width is
 * how many servers we talk to at the same time.
 */
export async function eachConcurrently<T>(
  items: readonly T[],
  width: number,
  work: (item: T) => Promise<void>,
  stopped: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stopped()) {
      const item = items[next++] as T;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, worker));
}
