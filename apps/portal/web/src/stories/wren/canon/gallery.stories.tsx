/** The shared gallery tile (canon/gallery.tsx) on its own: the dense wall a weaver run draws (WA-1405). */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { OUTLIER_ROWS } from "../../../mocks/data/outliers.js";
import { GALLERY_DENSE, Tile } from "../../../modules/canon/gallery.js";

const meta: Meta = { title: "Wren/Canon/Gallery" };
export default meta;

/** Dense: frame, multiple with no words, the one count the score is on, who; no hook, no note. */
export const Dense: StoryObj = {
  render: () => (
    <div className="@container/main p-4">
      <ul aria-label="Wall" className={`m-0 list-none p-0 ${GALLERY_DENSE}`}>
        {[...OUTLIER_ROWS, ...OUTLIER_ROWS].map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the fixture repeats on purpose
          <li key={i} className="min-w-0">
            <Tile
              r={r}
              canon={null}
              open="#"
              dense
              note="Copy: never shown dense"
              unscored={null}
            />
          </li>
        ))}
      </ul>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await c.findByRole("list", { name: "Wall" });
    await expect(c.queryByText("Copy: never shown dense")).toBeNull();
    await expect(c.queryByText(/their usual/)).toBeNull();
    await expect(c.queryByText("Not scored yet")).toBeNull();
  },
};
