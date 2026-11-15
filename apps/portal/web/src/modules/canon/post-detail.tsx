/**
 * One creator post, whole, in the record panel (studio-suite D9, D10): the Instagram and X post
 * page. The creator, the text, the picture, every count, why it stands out next to their usual
 * draw, and the creator's other accounts.
 */
import type { FeedPost } from "@wren/research/canon-console";
import type { FeedPerson } from "@wren/research/creators";
import {
  Button,
  ButtonLink,
  DetailSheet,
  Empty,
  Img,
  PlatformTile,
  short,
  Tag,
  useSeen,
} from "@wren/ui";
import {
  accountOf,
  age,
  type Canon,
  CanonTag,
  CountRow,
  cn,
  Face,
  followersText,
  HOT,
  kindName,
  nameOf,
  perFollower,
  platformName,
  ratio,
  tall,
  times,
  usePicture,
  usualTip,
  usualWhy,
  usualWords,
  when,
} from "./post-parts.js";

export type Account = FeedPerson["accounts"][number];

export interface OneSave {
  busy: boolean;
  error: string | null;
}

export function PostDetail({
  r,
  canon,
  save,
  onSave,
  creatorHref,
  face,
  also,
  onClose,
}: {
  /** null: the address names a post this list no longer holds */
  r: FeedPost | null;
  canon: Canon;
  save: OneSave | null;
  onSave: () => void;
  creatorHref: string | null;
  /** the creator's copied profile picture */
  face: string | null;
  /** the creator's other tracked accounts */
  also: Account[];
  onClose: () => void;
}) {
  useSeen(
    "record",
    r
      ? {
          label: `${nameOf(r)}'s ${kindName(r.kind).toLowerCase()}`,
          icon: "chart",
          text: [
            `${nameOf(r)} (@${r.handle}, ${platformName(r.platform)}), ${r.url}`,
            also.length
              ? `Also on ${also.map((a) => `${platformName(a.platform)} @${a.handle}`).join(", ")}`
              : null,
            r.title,
            r.text,
            usualTip(r),
          ]
            .filter(Boolean)
            .join("\n\n"),
        }
      : null,
  );
  if (!r)
    return (
      <DetailSheet title="Post" about="A creator post, whole." onClose={onClose}>
        <Empty
          title="This post isn't in this list"
          action={
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline"
            >
              Close
            </button>
          }
        >
          A filter or a newer read moved it out. Clear the filters to find it again.
        </Empty>
      </DetailSheet>
    );
  return (
    <DetailSheet
      title={r.title ?? `${nameOf(r)}'s ${kindName(r.kind).toLowerCase()}`}
      about="A creator post, whole: its counts and why it stands out."
      onClose={onClose}
    >
      <Body
        r={r}
        canon={canon}
        save={save}
        onSave={onSave}
        creatorHref={creatorHref}
        face={face}
        also={also}
      />
    </DetailSheet>
  );
}

function Body({
  r,
  canon,
  save,
  onSave,
  creatorHref,
  face,
  also,
}: {
  r: FeedPost;
  canon: Canon;
  save: OneSave | null;
  onSave: () => void;
  creatorHref: string | null;
  face: string | null;
  also: Account[];
}) {
  const pic = usePicture(r, true);
  const hot = (r.multiple ?? 0) >= HOT;
  const posted = when(r.postedAt);
  const reach = perFollower(r);
  const facts: [string, string][] = [
    ...(reach != null
      ? ([
          [
            "Views per follower",
            `${ratio(reach)} (${short(r.counts.views as number)} views, ${short(r.followers as number)} followers)`,
          ],
        ] as [string, string][])
      : []),
    ...(r.likesMultiple != null && r.scoreCount !== "likes"
      ? ([["On likes", `${times(r.likesMultiple)} their usual likes`]] as [string, string][])
      : []),
    ...(r.rank != null
      ? ([["Rank", `Top ${Math.round(r.rank)}% of their ${kindName(r.kind).toLowerCase()}s`]] as [
          string,
          string,
        ][])
      : []),
  ];
  return (
    <div className="grid gap-6">
      {/* a div: a header in the dialog reads as a second banner */}
      <div className="flex min-w-0 items-start gap-3">
        <Face name={nameOf(r)} src={face} size={44} />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="m-0 text-[15px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
            {nameOf(r)}
          </p>
          <p className="m-0 text-[13px] leading-snug wrap-anywhere text-(--ui-ink-3)">
            {[accountOf(r), followersText(r.followers)].filter(Boolean).join(" · ")}
          </p>
          {r.niches.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {r.niches.map((n) => (
                <Tag key={n}>{n}</Tag>
              ))}
            </div>
          ) : null}
          {creatorHref ? (
            <a
              href={creatorHref}
              className="mt-1 justify-self-start text-[13px] font-semibold text-(--ui-ink-2) hover:text-(--ui-ink)"
            >
              All posts by {nameOf(r)}
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        {r.title ? (
          <h2 className="m-0 text-[17px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
            {r.title}
          </h2>
        ) : null}
        {r.text ? (
          <p className="m-0 text-[14.5px] leading-[1.55] whitespace-pre-line wrap-anywhere text-(--ui-ink)">
            {r.text}
          </p>
        ) : null}
        {pic.src ? (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "block overflow-hidden rounded-[6px]",
              tall(r) ? "w-[min(100%,360px)]" : "w-full",
            )}
          >
            <Img
              src={pic.src}
              alt={r.title ?? r.text ?? ""}
              onError={pic.fail}
              className={cn("block w-full object-cover", tall(r) ? "aspect-[4/5]" : "aspect-video")}
            />
          </a>
        ) : null}
        <CountRow r={r} full className="text-[14px] text-(--ui-ink-2)" />
        {posted ? (
          <p className="m-0 text-[13px] text-(--ui-ink-3)">
            {posted}
            {age(r.postedAt) ? ` · ${age(r.postedAt)}` : ""}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="post-why" className="grid gap-2">
        <h3 id="post-why" className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">
          {r.multiple != null ? "Why it stands out" : "Score"}
        </h3>
        {r.multiple != null ? (
          <p
            className={cn(
              "m-0 text-[28px] leading-tight font-semibold tabular-nums",
              hot ? "text-(--ui-active)" : "text-(--ui-ink)",
            )}
          >
            {times(r.multiple)}{" "}
            <span className="text-[15px] font-normal text-(--ui-ink-3)">{usualWords(r)}</span>
          </p>
        ) : null}
        {usualWhy(r).map((line) => (
          <p key={line} className="m-0 text-[14px] leading-[1.5] text-(--ui-ink)">
            {line}
          </p>
        ))}
        {facts.length ? (
          <dl className="m-0 mt-1 grid grid-cols-[minmax(0,150px)_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-(--ui-ink-3)">{k}</dt>
                <dd className="m-0 text-(--ui-ink) tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {also.length ? (
        <section aria-labelledby="post-also" className="grid gap-2">
          <h3 id="post-also" className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">
            Also on
          </h3>
          <ul className="m-0 grid list-none gap-1.5 p-0 text-[14px]">
            {also.map((a) => (
              <li key={a.id} className="flex min-w-0 items-start gap-1.5 wrap-anywhere">
                <PlatformTile mark={a.platform} className="mt-[3px] shrink-0" />
                <span className="min-w-0">
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-(--ui-ink) underline-offset-2 hover:underline"
                    >
                      {platformName(a.platform)}
                    </a>
                  ) : (
                    <span className="font-semibold text-(--ui-ink)">
                      {platformName(a.platform)}
                    </span>
                  )}
                  <span className="text-(--ui-ink-3)">
                    {" "}
                    @{a.handle}
                    {followersText(a.followers) ? ` · ${followersText(a.followers)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink size="dense" icon="external" href={r.url} target="_blank" rel="noreferrer">
            Open on {platformName(r.platform)}
          </ButtonLink>
          {canon ? (
            <CanonTag canon={canon} />
          ) : (
            <Button size="dense" tone="primary" busy={save?.busy ?? false} onClick={onSave}>
              Save to Canon
            </Button>
          )}
        </div>
        {save?.error ? (
          <p role="alert" className="m-0 text-[13px] text-(--ui-bad)">
            Not saved: {save.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
