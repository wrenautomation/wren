/** A file for the person: a text downloaded, and the text of a file they picked. */

/** Downloads `text` as a file called `name`. */
export function saveText(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A file name for a shape: its name in lowercase letters and dashes, with the extension. */
export const fileNameOf = (name: string): string =>
  `${
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shape"
  }.yaml`;
