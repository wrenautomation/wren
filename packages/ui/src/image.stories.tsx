import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { Img } from "./image.js";

export default {
  title: "Components/Media/Image",
  id: "image",
} satisfies Meta;

type Story = StoryObj;

const PIC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#c9b8a4"/><circle cx="230" cy="70" r="34" fill="#f4ead9"/><path d="M0 200 L110 90 L200 170 L250 130 L320 200Z" fill="#7d6a55"/></svg>',
)}`;
const box = "h-[120px] w-[190px] rounded-lg object-cover";
const label = "mt-1.5 text-[12px] text-(--ui-ink-3)";

/** Loading, failed, in; and a round avatar loading. */
export const States: Story = {
  render: () => (
    <div className="flex flex-wrap gap-5 p-4">
      <figure>
        {/* the wait look held still: a real load ends too fast to see */}
        <img className={`ui-img ${box}`} data-img="wait" alt="" />
        <figcaption className={label}>Loading</figcaption>
      </figure>
      <figure>
        <Img src="/no-such-picture.png" alt="Missing" className={box} />
        <figcaption className={label}>Failed</figcaption>
      </figure>
      <figure>
        <Img src={PIC} alt="Hills" className={box} />
        <figcaption className={label}>Loaded</figcaption>
      </figure>
      <figure>
        <img className="ui-img size-10 rounded-full" data-img="wait" alt="" />
        <figcaption className={label}>Avatar</figcaption>
      </figure>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-img="bad"]')).not.toBeNull();
      expect(canvasElement.querySelector('img[alt="Hills"][data-img="in"]')).not.toBeNull();
    });
    // no alt on a failed picture: no broken-image icon
    expect(canvasElement.querySelector('[data-img="bad"]')?.getAttribute("alt")).toBe("");
  },
};
