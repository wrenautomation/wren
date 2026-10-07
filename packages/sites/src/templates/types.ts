/**
 * A template: its copy fields and how it lays them out. The fields are what a person, the CLI or
 * Claude fills; the layout is code, reviewed in git. A page's content is the fields' values.
 */
import type { Offer } from "@wren/offers";
import type { FormSpec } from "../forms.js";

/** A line, a paragraph, one item per line, an address, or a list of small groups. */
export type FieldKind = "text" | "long" | "lines" | "url" | "items";

export interface CopyField {
  key: string;
  label: string;
  kind: FieldKind;
  /** Characters, or for `lines` and `items` the most entries. */
  max: number;
  hint?: string;
  optional?: true;
  /** Starts a group of fields in the copy editor; the fields after it join it. */
  group?: string;
  /** An `items` field's own fields: text, long or url only. */
  items?: readonly CopyField[];
}

export type ItemValue = Record<string, string>;
export type FieldValue = string | string[] | ItemValue[];
export type Content = Record<string, FieldValue>;

/** What a page's render knows past its words. */
export interface RenderContext {
  /** Its id: the tracker and the form name it. */
  page: string;
  /** Where the tracker and form post: "" on the page's own host. */
  base: string;
  /** Draft previews leave the tracker out, so nothing is counted. */
  track: boolean;
  /** A small note across the top: "Draft preview". */
  banner?: string;
  /** The hosted form the page's `form` field names, when it's live: its fields replace the default. */
  form?: { id: string; spec: FormSpec } | null;
  /** The split that served this arm: the kit sends it with every event and form. */
  split?: string | null;
}

export interface Template {
  id: string;
  name: string;
  blurb: string;
  fields: readonly CopyField[];
  /** The first draft from an offer's data, no model: the words a person then edits. */
  fill(offer: Offer, o: { angle?: string | null; audience?: string | null }): Content;
  /** The page's body, every value already checked (`checkContent`). Escapes everything it prints. */
  body(c: Content, ctx: RenderContext): string;
  /** The `<title>` and description. */
  head(c: Content): { title: string; description: string };
}
