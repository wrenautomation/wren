/** Layers: each fold's inside lifts over its stop. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { bigAnswers } from "../../../mocks/data/map.js";
import { LATE, mapAt, SHARED } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Layers", globals: { data: "tidy" } };
export default meta;

/** A plate's button: "Look at <part>", and nothing else on the page. */
const plateName = (name: string, el: Element) =>
  name.startsWith("Look at ") && el.classList.contains("mlay-open");

/** Layers (an experiment): the whole map at the bottom, each part on a plate over its place. */
export const Default = mapAt("/?look=layers", {
  answers: bigAnswers(SHARED),
  check: async (page) => {
    await expect(within(page).getByRole("link", { name: "Layers" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const plates = await within(page).findAllByRole("button", { name: plateName }, LATE);
    await expect(plates.length).toBeGreaterThan(1);
    // Together lands every plate; Apart lifts them again.
    const view = within(page).getByRole("group", { name: "View" });
    await userEvent.click(within(view).getByRole("button", { name: "Together" }));
    await waitFor(
      () =>
        expect(within(view).getByRole("button", { name: "Together" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
      LATE,
    );
    await expect(page.querySelector(".mlay-stage.landed")).not.toBeNull();
    await userEvent.click(within(view).getByRole("button", { name: "Apart" }));
    await waitFor(() => expect(page.querySelector(".mlay-stage.landed")).toBeNull(), LATE);
  },
});

/** A part as the floor (`floor=`): the crumbs name it and lead back; with nothing to split, it lies flat. */
export const Floor = mapAt("/?look=layers&floor=line:growth", {
  answers: bigAnswers(SHARED),
  check: async (page) => {
    const crumbs = await within(page).findByRole("navigation", { name: "Floor" });
    await expect(await within(crumbs).findByText("Growth", {}, LATE)).toBeVisible();
    await waitFor(() => expect(page.querySelector(".mlay-stage.landed")).not.toBeNull(), LATE);
    await userEvent.click(within(crumbs).getByRole("button", { name: "Whole map" }));
    await within(page).findAllByRole("button", { name: plateName }, LATE);
  },
});

/** Settle: the camera looks down on a plate and stays in Layers; Esc steps back. */
export const Settle = mapAt("/?look=layers", {
  answers: bigAnswers(SHARED),
  check: async (page) => {
    const [plate] = await within(page).findAllByRole("button", { name: plateName }, LATE);
    // plates take no pointer hits (the camera's math does): the keys' way in
    (plate as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(page.querySelector(".mlay-stage.settled")).not.toBeNull(), LATE);
    await expect(page.querySelector(".mlay-slot.chosen")).not.toBeNull();
    await expect(within(page).queryByRole("navigation", { name: "Open part" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(page.querySelector(".mlay-stage.settled")).toBeNull(), LATE);
  },
});

/** Layers, one plate shut (`shut=`): its Lift mark on its stop, no plate. */
export const Shut = mapAt("/?look=layers&shut=node%3Aaudit%40", {
  answers: bigAnswers(SHARED),
  check: async (page) => {
    await expect(
      await within(page).findByRole("button", { name: "Lift Audit" }, LATE),
    ).toBeVisible();
    await expect(within(page).queryByRole("button", { name: "Shut Audit" })).toBeNull();
  },
});
