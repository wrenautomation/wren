/**
 * Vireo in Explorer (designs/2026-11-12-explorer.md): the preview of a subject, a batch, a sample
 * and a guide. Read only: marking stays in Batches. An open batch comes blind from the server, so
 * nothing here can show what Vireo hides.
 */
import { segments, type Whole } from "@wren/core/paths";
import type { VireoGuide, VireoSample } from "@wren/paths/vireo-tree";
import { Img, num, Tag, type TagTone, Video } from "@wren/ui";
import { href } from "../../route.js";
import { LivePage } from "./live-page.js";

/** Vireo's row marks: an open batch, a kept sample, a guide's state, a subject not open. */
export const VIREO_MARKS: Record<string, { label: string; tone?: TagTone }> = {
  open: { label: "Open", tone: "warn" },
  kept: { label: "Kept", tone: "green" },
  testing: { label: "Testing" },
  locked: { label: "Locked", tone: "green" },
  dropped: { label: "Dropped" },
  paused: { label: "Paused" },
  done: { label: "Done" },
};

/** What fills Vireo's empty areas: an agent's subject, a guide from a note or a study. */
export const vireoFills = (route: string) =>
  route === "vireo/subjects" ? (
    <>
      An agent starts one with <code>wren variants new</code>; it shows in{" "}
      <a href="/variants/subjects">Subjects</a>.
    </>
  ) : route === "vireo/guides" ? (
    <>
      A guide comes from a study, an SOP or a note you leave in{" "}
      <a href="/variants/batches">Batches</a>.
    </>
  ) : undefined;

const Facts = ({ items }: { items: (string | null | false)[] }) => (
  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-3)">
    {items.filter(Boolean).map((f) => (
      <span key={String(f)}>{f}</span>
    ))}
  </span>
);

const Text = ({ text }: { text: string }) => (
  <p className="m-0 text-[14.5px] leading-normal whitespace-pre-wrap text-pretty wrap-anywhere">
    {text}
  </p>
);

/** One sample as its kind draws it: words, a still, a cut, a page. */
function SampleMedia({ s, kind }: { s: VireoSample; kind: string }) {
  if (kind === "video" && s.mediaUrl) return <Video src={s.mediaUrl} poster={s.posterUrl} />;
  if (kind === "image" && (s.mediaUrl ?? s.posterUrl))
    return (
      <div className="overflow-hidden rounded-(--ui-radius) bg-(--ui-tile)">
        <Img src={s.mediaUrl ?? s.posterUrl ?? ""} alt="" className="block w-full" />
      </div>
    );
  if (kind === "page" && s.mediaUrl)
    return <LivePage id={s.id} url={s.mediaUrl} still={s.posterUrl} />;
  if (kind === "page" && s.body)
    // static html in a frame with no origin of its own, as Batches shows it
    return (
      <div className="overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-white">
        <iframe
          title={s.name ?? `Sample ${s.id}`}
          sandbox="allow-scripts"
          srcDoc={s.body}
          className="block h-[420px] w-full"
        />
      </div>
    );
  return s.body ? <Text text={s.body} /> : null;
}

export function VireoPreview({ w }: { w: Whole }) {
  const [, area, slug, layer, , sample] = segments(w.path);
  if (area === "guides" && w.data) {
    // the header holds its text, source and scope; the samples that apply it are its links
    const mark = VIREO_MARKS[(w.data as VireoGuide).state];
    return mark ? (
      <span>
        <Tag {...(mark.tone ? { tone: mark.tone } : {})}>{mark.label}</Tag>
      </span>
    ) : null;
  }
  if (area !== "subjects" || !slug || !w.data) return w.body ? <Text text={w.body} /> : null;
  if (!layer) {
    const d = w.data as { subject: { id: number; kind: string }; batches: number; guides: number };
    return (
      <div className="flex max-w-[72ch] flex-col gap-4">
        {w.body ? <Text text={w.body} /> : null}
        <Facts
          items={[
            `${num(d.batches)} ${d.batches === 1 ? "batch" : "batches"}`,
            `${num(d.guides)} ${d.guides === 1 ? "guide" : "guides"} under test`,
          ]}
        />
        <a href={href("/variants/subjects", { subject: d.subject.id })} className="self-start">
          Open in Subjects
        </a>
      </div>
    );
  }
  if (!sample) {
    const b = w.data as {
      ref: string;
      state: string;
      note: string | null;
      blind: boolean;
      samples: number;
      detail: { goodRate?: number | null; judges?: number };
    };
    const rate = b.detail.goodRate;
    return (
      <div className="flex max-w-[72ch] flex-col gap-4">
        {b.blind ? (
          <p className="m-0 text-[14px] text-(--ui-ink-2)">
            Open: its why, lineage and guides stay hidden until you mark it.
          </p>
        ) : w.body ? (
          <Text text={w.body} />
        ) : null}
        {b.note ? (
          <blockquote className="m-0 text-[14px] text-(--ui-ink-2) italic">{b.note}</blockquote>
        ) : null}
        <Facts
          items={[
            rate != null ? `${Math.round(rate * 100)}% good` : null,
            b.detail.judges ? `${num(b.detail.judges)} judged` : null,
          ]}
        />
        <a href={href("/variants/batches", { b: b.ref })} className="self-start">
          {b.state === "open" ? "Mark it in Batches" : "Open in Batches"}
        </a>
      </div>
    );
  }
  // the header's sub holds its verdict and score
  const d = w.data as { sample: VireoSample; kind: string; batch: string; blind: boolean };
  const s = d.sample;
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      <SampleMedia s={s} kind={d.kind} />
      {s.keptAt ? (
        <span>
          <Tag tone="green">Kept</Tag>
        </span>
      ) : !s.verdict && d.blind ? (
        <span className="text-[13px] text-(--ui-ink-3)">Not marked yet</span>
      ) : null}
      {typeof s.detail.change === "string" && s.detail.change ? (
        <Facts items={[`Changed: ${s.detail.change}`]} />
      ) : null}
      <a href={href("/variants/batches", { b: d.batch })} className="self-start">
        Open in Batches
      </a>
    </div>
  );
}
