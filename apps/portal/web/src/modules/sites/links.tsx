/**
 * Tracked links (designs/2026-10-07-sites.md, "Phase 2"): a `/go/` link to one page, with where
 * it's posted and the post or ad id as its utm. The form shows the link to copy and its QR code,
 * drawn here (`@wren/sites/qr`, no service). Each link's row holds what it brought.
 */
import type { Row } from "@wren/core/records/serve";
import { qrMatrix, qrPath } from "@wren/sites/qr";
import {
  Button,
  CopyButton,
  num,
  type RecordExtras,
  Section,
  SelectField,
  TextField,
  useEditForm,
} from "@wren/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { type ListPage, type PageProps, WREN } from "../../module.js";
import { QUIET } from "../work/bits.js";

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";

const HINT = "text-[12px] text-(--ui-ink-3)";
/** A field's name in the form's weight. */
const named = (text: ReactNode) => <span className="font-medium">{text}</span>;

/** Where a link is posted: the short name, as the edge reads it. Wren's lander knows the first nine. */
const PLACES: [string, string][] = [
  ["ads", "Meta ad"],
  ["fb", "Facebook post"],
  ["ig", "Instagram"],
  ["li", "LinkedIn"],
  ["yt", "YouTube"],
  ["tt", "TikTok"],
  ["x", "X"],
  ["rd", "Reddit"],
  ["sms", "Text message"],
  ["gbp", "Google Business"],
  ["gads", "Google ad"],
  ["email", "Email"],
];
const WREN_PLACES = new Set(["ads", "fb", "ig", "li", "yt", "tt", "x", "rd", "sms"]);

interface Targets {
  owners: { id: string; name: string }[];
  pages: { id: string; title: string; slug: string; status: string }[];
  host: string | null;
}
interface Made {
  id: string;
  url: string | null;
}

/** The code for a link as an SVG: black on white whatever the theme, so phones read it. */
export function Qr({ text, size = 168 }: { text: string; size?: number }) {
  const m = useMemo(() => qrMatrix(text), [text]);
  if (!m) return <p className={HINT}>Too long for a QR code.</p>;
  const n = m.length + 8;
  return (
    <svg
      role="img"
      aria-label={`QR code for ${text}`}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block border border-(--ui-hair)"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={qrPath(m)} fill="#000" />
    </svg>
  );
}

/** Save the code as a PNG at print size, drawn from the same modules. */
function savePng(text: string, name: string) {
  const m = qrMatrix(text);
  if (!m) return;
  const scale = 12;
  const n = (m.length + 8) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, n, n);
  g.fillStyle = "#000";
  for (const [y, row] of m.entries())
    for (const [x, dark] of row.entries())
      if (dark) g.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${name}.png`;
  a.click();
}

/** The link, Copy, the QR code and Save PNG. */
function LinkOut({ url, name }: { url: string; name: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
      <div className="grid min-w-0 gap-2">
        <span className={LABEL}>Your link</span>
        <code className="block bg-(--ui-fill) p-2 text-[13px] break-all">{url}</code>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={url} label="Copy link" tone="primary" />
          <Button size="sm" tone="secondary" onClick={() => savePng(url, name)}>
            Save QR as PNG
          </Button>
        </div>
        <span className={HINT}>
          Every visit, form and booking from it counts on this link and on its page.
        </span>
      </div>
      <Qr text={url} />
    </div>
  );
}

/** The New link form: owner (Wren's workspace), page, where it's posted, campaign and id. */
function NewLink({ at, reload }: { at: PageProps; reload: () => void }) {
  const wren = at.client === WREN.id;
  const form = useEditForm({
    key: "link:new",
    defaults: {
      owner: wren ? "wren" : at.client,
      page: "",
      place: "ads",
      campaign: "",
      content: "",
    },
  });
  const { owner, page: picked } = form.watch();
  const [made, setMade] = useState<Made | null>(null);
  const [open, setOpen] = useState(false);
  // Another owner, another set of pages: the last link made is no longer this one's.
  const { watch } = form;
  useEffect(() => {
    const sub = watch((_, { name }) => {
      if (name === "owner") setMade(null);
    });
    return () => sub.unsubscribe();
  }, [watch]);
  const body = useCallback(
    (more: Record<string, unknown>) =>
      wren ? { owner, ...more } : { client: at.client, owner: at.client, ...more },
    [wren, owner, at.client],
  );
  // The pages a link may go to, for this owner: read when the form opens, kept.
  const got = useCall(
    open ? `sites:linkTargets:${at.client}:${wren ? owner : at.client}` : null,
    () => call<Targets>("sites/linkTargets", body({})),
  );
  const t = got.data ?? null;
  const page = t?.pages.some((x) => x.id === picked) ? picked : (t?.pages[0]?.id ?? "");
  const shownErr = form.error ?? (got.error && !t ? got.error.message : null);
  const places = PLACES.filter(([k]) => owner !== "wren" || WREN_PLACES.has(k));
  const slug = t?.pages.find((p) => p.id === page)?.slug ?? "";
  const submit = form.onSend(async (v) => {
    setMade(null);
    const r = await call<Made>(
      "sites/linkCreate",
      body({ page, link: v.place, campaign: v.campaign || null, content: v.content || null }),
    );
    setMade(r);
    reload();
  });
  if (at.demo) return null;
  if (!open)
    return (
      <Button tone="primary" onClick={() => setOpen(true)}>
        New link
      </Button>
    );
  return (
    <div className="w-full min-w-0 basis-full">
      <Section
        title="New tracked link"
        note="Pick the page and where the link goes. Add the post or ad id so each one counts apart."
        actions={
          <Button size="sm" tone="quiet" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            {wren && t && t.owners.length > 1 ? (
              <SelectField
                form={form}
                name="owner"
                label={named("Whose")}
                className="gap-1.5"
                options={t.owners.map((o) => [o.id, o.name] as const)}
              />
            ) : null}
            <div className="grid gap-1.5">
              <SelectField
                form={form}
                name="page"
                label={named("Page")}
                className="gap-1.5"
                disabled={!t?.pages.length}
                options={(t?.pages ?? []).map(
                  (p) => [p.id, `${p.title}${p.status === "live" ? "" : " (draft)"}`] as const,
                )}
              />
              {t && !t.pages.length ? (
                <span className={HINT}>No pages yet. Links go to a page made in Sites.</span>
              ) : null}
            </div>
            <SelectField
              form={form}
              name="place"
              label={named("Where it's posted")}
              className="gap-1.5"
              options={places}
            />
            <div className="grid gap-1.5">
              <TextField
                form={form}
                name="campaign"
                label={named(
                  <>
                    Campaign <span className={HINT}>(optional)</span>
                  </>,
                )}
                className="gap-1.5"
                maxLength={80}
                placeholder={slug || "spring-promo"}
              />
              <span className={HINT}>Left empty, the page's name.</span>
            </div>
            <TextField
              form={form}
              name="content"
              label={named(
                <>
                  Post or ad id <span className={HINT}>(optional)</span>
                </>,
              )}
              className="gap-1.5"
              maxLength={80}
              placeholder="120211234567890"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              tone="primary"
              busy={form.formState.isSubmitting}
              disabled={!page}
            >
              Make link
            </Button>
            {shownErr ? <span className="text-[13px] text-(--ui-bad)">{shownErr}</span> : null}
            {t && !t.host ? (
              <span className={HINT}>
                No live address yet. The link shows once the client's host is live.
              </span>
            ) : null}
          </div>
          {made?.url ? (
            <div className="border-t border-(--ui-hair) pt-4">
              <LinkOut url={made.url} name={`link-${made.id.slice(0, 8)}`} />
            </div>
          ) : null}
        </form>
      </Section>
    </div>
  );
}

export const linkHead: NonNullable<ListPage["head"]> = (_meta, reload, at) => (
  <NewLink at={at} reload={reload} />
);

/** A link's detail: the link and its code first, then what it brought. */
export const linkExtras: NonNullable<ListPage["extras"]> = (_detail, { row }) => extrasOf(row);

function extrasOf(row: Row): RecordExtras {
  const url = row.url ? String(row.url) : null;
  const clicks = row.clicks === null || row.clicks === undefined ? null : Number(row.clicks);
  const facts: [string, string][] = [
    ["Clicks", clicks === null ? "Not counted on Wren's lander" : num(clicks)],
    ["Visits", num(Number(row.visits ?? 0))],
    ["Forms", num(Number(row.forms ?? 0))],
    ["Bookings", num(Number(row.books ?? 0))],
  ];
  return {
    top: url ? (
      <Section title="Link and QR code">
        <LinkOut url={url} name={`link-${String(row.id).slice(0, 8)}`} />
      </Section>
    ) : (
      <p className={`text-[13.5px] ${QUIET}`}>
        No live address yet. The link shows once the client's host is live.
      </p>
    ),
    facts,
  };
}
