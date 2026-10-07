/** William's texts as the person gets them on a phone and a laptop, filled with sample facts. */
import { preview, type RenderFields, segments } from "@wren/channel-sms/templates";
import { type MessageKind, MessagePreview, type RecordExtras } from "@wren/ui";
import { call } from "../../api.js";
import type { ListPage } from "../../module.js";

function kindOf(sample: RenderFields | undefined): MessageKind {
  const fill = (text: string) => {
    let body = text.trim();
    try {
      if (sample) body = preview(body, sample);
    } catch {
      // Saving says why.
    }
    return { subject: null, body };
  };
  return { kind: "sms", parts: segments, fill };
}

export const textCopyExtras: NonNullable<ListPage["extras"]> = (detail, { row }) => {
  const sample = (detail as { sample?: RenderFields } | null)?.sample;
  const body = String(row.body ?? "");
  return {
    sections: [
      [
        "How it looks",
        body ? (
          <MessagePreview key="looks" message={kindOf(sample)} body={body} />
        ) : (
          "Empty: this text never goes."
        ),
      ],
    ],
  } satisfies RecordExtras;
};

/** The edit box's preview, filled as you type. */
export const textCopyPreview = (id: string | number) =>
  call<{ detail?: { sample?: RenderFields } }>("console/recordsGet", {
    record: "marketing.text_copy",
    id: String(id),
  }).then((r) => kindOf(r.detail?.sample));
