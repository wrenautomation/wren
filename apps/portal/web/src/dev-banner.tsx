/**
 * `pnpm dev` only (designs/2026-10-21-dev-loop.md): a mark that this tab reads prod, and whether it
 * may write. Vite sets `__WREN_DEV__` on the dev server; a build and Storybook have none.
 */
declare const __WREN_DEV__: { writes: boolean } | undefined;
export const WREN_DEV = typeof __WREN_DEV__ === "undefined" ? null : __WREN_DEV__;

export function DevBanner() {
  if (!WREN_DEV) return null;
  return (
    <div
      role="status"
      data-look-over
      className="pointer-events-none fixed right-3 bottom-3 z-[1000] rounded-full border border-(--ui-hair) bg-(--ui-paper) px-3 py-1 text-[12px] text-(--ui-ink-2) shadow-(--ui-shadow)"
    >
      dev · prod data ·{" "}
      {WREN_DEV.writes ? <b className="text-(--ui-bad)">writes on</b> : "writes off"}
    </div>
  );
}
