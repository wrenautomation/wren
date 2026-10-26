/** Commander's reducer for a repeatable option: each use adds one value. */
export const collect = (v: string, prev: string[] = []): string[] => [...prev, v];
