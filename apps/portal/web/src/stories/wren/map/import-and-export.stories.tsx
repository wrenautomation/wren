/** Export the shape or a draft; import a file. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";
import { FILE_TEXT, liveShape, MAP_CALLS } from "../../../mocks/data/map.js";
import { banner, mapAt, SHARED, station, tools } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Import and export", globals: { data: "tidy" } };
export default meta;

// --- import and export -------------------------------------------------------------------------

/** Export downloads the shape as a YAML file; the call names the version, never a body. */
export const Export = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await station(page, "Engaged");
    const names: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    try {
      await userEvent.click((await tools(page)).getByRole("button", { name: "Export" }));
      await waitFor(() => expect(names).toEqual(["sample-shape.yaml"]));
      await expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeExport"]);
      const sent = MAP_CALLS[0]?.body as Record<string, unknown>;
      await expect(sent).toMatchObject({ ref: 2 });
      await expect(sent).not.toHaveProperty("body");
    } finally {
      click.mockRestore();
    }
  },
});

/** Export on an open draft names the draft: `ref` is `draft:<id>`. */
export const ExportDraft = mapAt("/?draft=d1", {
  check: async (page) => {
    await banner(page);
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click((await tools(page)).getByRole("button", { name: "Export" }));
      await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeExport"]));
      const sent = MAP_CALLS[0]?.body as Record<string, unknown>;
      await expect(sent).toMatchObject({ ref: "draft:d1" });
      await expect(sent).not.toHaveProperty("body");
    } finally {
      click.mockRestore();
    }
  },
});

/** Import a file: the Map draws it with marks, the card lists what it changes, then Save. */
export const ImportFile = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await station(page, "Engaged");
    const file = new File([FILE_TEXT], "sample.yaml", { type: "text/yaml" });
    await userEvent.upload(within(page).getByLabelText("Shape file"), file);
    const card = await within(page).findByRole("region", { name: "Import a shape" });
    const changes = await within(card).findByRole("region", { name: "Changes" });
    await expect(within(changes).getByText("Added station Replied.")).toBeVisible();
    await expect(within(changes).getByText("Added track Engaged to Replied.")).toBeVisible();
    // The preview draws the file with its marks.
    await station(page, "Replied, .*added");
    const save = within(card).getByRole("button", { name: "Save version" });
    await expect(save).toBeDisabled();
    await userEvent.type(within(card).getByRole("textbox", { name: "Why it changed" }), "Imported");
    await userEvent.click(save);
    await waitFor(() => expect(MAP_CALLS.map((c) => c.path)).toEqual(["shapeImport"]));
    await expect(MAP_CALLS[0]?.body).toMatchObject({ text: FILE_TEXT, note: "Imported" });
    await station(page, "Replied");
    await expect(within(page).queryByRole("region", { name: "Import a shape" })).toBeNull();
  },
});

/** A file that is no shape: the server's sentence shows, and nothing can be saved. */
export const ImportRefused = mapAt("/", {
  answers: liveShape(SHARED),
  check: async (page) => {
    await station(page, "Engaged");
    const file = new File(["hello"], "notes.yaml", { type: "text/yaml" });
    await userEvent.upload(within(page).getByLabelText("Shape file"), file);
    const card = await within(page).findByRole("region", { name: "Import a shape" });
    await expect(await within(card).findByText("The file is not a shape file.")).toBeVisible();
    await expect(within(card).queryByRole("button", { name: "Save version" })).toBeNull();
  },
});
