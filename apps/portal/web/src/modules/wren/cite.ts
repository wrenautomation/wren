/** A cited `path:line` as its page on GitHub (the repos are public), so anyone can check it. */
export function sourceOf(cite: string): string | null {
  const m = /^(?:\.\.\/)?([\w.-]+(?:\/[\w.-]+)*\.\w+)(?::(\d+))?/.exec(cite);
  if (!m?.[1]) return null;
  const [top, ...rest] = m[1].split("/");
  const other = top === "autobrowse" || top === "lander";
  const path = other ? rest.join("/") : m[1];
  if (!path.includes("/") && !other) return null;
  return `https://github.com/wrenautomation/${other ? top : "wren"}/blob/main/${path}${m[2] ? `#L${m[2]}` : ""}`;
}
