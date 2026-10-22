import { useCallback, useState } from "react";

/**
 * The folds of a `Rows` list (`group`): which groups are shut, and shut or open one. `shut` names
 * the groups that start shut. Kept in the page; a fold is a view, not a write.
 */
export function useFolds(shut: readonly string[] = []) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(shut));
  const toggle = useCallback(
    (key: string) =>
      setFolded((was) => {
        const next = new Set(was);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  return { folded, toggle };
}
