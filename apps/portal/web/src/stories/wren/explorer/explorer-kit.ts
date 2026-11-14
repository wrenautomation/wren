/** Plays shared by Explorer's stories. */
import { expect, type within } from "storybook/test";
import { explorerHref } from "../../../modules/explorer/href.js";

type View = ReturnType<typeof within>;

export const WAIT = { timeout: 5000 };

// Explorer shows one pane under 720px of its own (`WIDE`, @wren/ui explorer.tsx); at 390 the page is under it
const narrow = () => innerWidth < 720;

/**
 * A relation of the open item: its folder in the column when wide; its section in the preview when
 * narrow, or when the column shows tiles (the preview lists it, so the column drops it: `unlisted`).
 */
export async function relation(view: View, name: string, route: string) {
  if (narrow() || document.querySelector('[data-look="tiles"]')) {
    await expect(await view.findByRole("region", { name }, WAIT)).toBeVisible();
    return;
  }
  await expect(
    await view.findByRole("link", { name: new RegExp(`^${name}`) }, WAIT),
  ).toHaveAttribute("href", explorerHref(route));
}

/** Explorer's row to `href`, not the sidebar's link of the same name. */
export async function linkTo(view: View, name: RegExp, href: string) {
  const links = await view.findAllByRole("link", { name }, WAIT);
  await expect(links.map((l: HTMLElement) => l.getAttribute("href"))).toContain(href);
}
