/**
 * A TikTok post's settings as TikTok's Direct Post rules ask (developers.tiktok.com/doc/
 * content-sharing-guidelines, `@wren/core/content/tiktok`): the account it posts to, who can see
 * it with nothing picked for you, comments, duets and stitches off until turned on and greyed
 * where the account turned them off, the content disclosure with its labels, the video against the
 * account's longest, and TikTok's declaration above the yes. Each choice saves as it's made.
 */
import {
  TIKTOK_COPY,
  TIKTOK_PRIVACY,
  TIKTOK_PRIVACY_LABELS,
  type TikTokCreator,
  type TikTokPrivacy,
  tiktokDeclaration,
  tiktokLabel,
} from "@wren/core/content/tiktok";
import { useState } from "react";
import { SELECT } from "../work/bits.js";

const LABEL = "text-[13px] font-medium text-(--ui-ink-2)";
const HINT = "text-[12px] text-(--ui-ink-3)";
const WARN = "text-[13px] text-(--ui-bad)";
const GROUP_HEAD =
  "text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";

/** The choices as now: saved, or as just picked. */
export type TikTokValues = {
  privacy?: string;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  disclose?: boolean;
  yourBrand?: boolean;
  brandedContent?: boolean;
};

export interface TikTokPanelProps {
  values: TikTokValues;
  /** Saves one choice; answers why not, or null. */
  choose: (key: keyof TikTokValues, value: unknown) => Promise<string | null>;
  /** The account as TikTok answered when the post opened; absent: Wren's own, no live read. */
  tiktok: { creator: TikTokCreator | null; note: string | null } | undefined;
  /** A signed link to the post's video. */
  video: string | null;
}

/** One checkbox: off unless picked; greyed with why when it can't be. */
function Check({
  id,
  label,
  hint,
  on,
  off,
  pick,
}: {
  id: string;
  label: string;
  hint?: string;
  on: boolean;
  off?: string | null;
  pick: (on: boolean) => void;
}) {
  return (
    <div className="grid gap-0.5" title={off ?? undefined}>
      <label
        htmlFor={id}
        className={`flex items-center gap-2.5 ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <input
          id={id}
          type="checkbox"
          checked={on && !off}
          disabled={!!off}
          onChange={(e) => pick(e.target.checked)}
          className="size-4 accent-(--ui-accent)"
        />
        <span className="text-[14px]">{label}</span>
      </label>
      {hint ? <span className={`${HINT} pl-6.5`}>{hint}</span> : null}
      {off ? <span className={`${HINT} pl-6.5`}>{off}</span> : null}
    </div>
  );
}

/** Who the post goes to: the creator's nickname, or why it can't be read. */
function Account({ tiktok }: { tiktok: TikTokPanelProps["tiktok"] }) {
  const c = tiktok?.creator;
  if (!c)
    return (
      <div className="grid gap-1">
        <span className={LABEL}>Posting to</span>
        <span className="text-[14px]">
          {tiktok ? (tiktok.note ?? "Couldn't read the account.") : "Wren's TikTok"}
        </span>
      </div>
    );
  return (
    <div className="grid gap-1">
      <span className={LABEL}>Posting to</span>
      <div className="flex items-center gap-2.5">
        {c.avatarUrl ? (
          <img src={c.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
        ) : null}
        <span className="text-[14px] font-medium">{c.nickname}</span>
        {c.username ? <span className={HINT}>@{c.username}</span> : null}
      </div>
      {!c.canPost ? (
        <span role="alert" className={WARN}>
          {TIKTOK_COPY.tryLater}
        </span>
      ) : null}
    </div>
  );
}

/** The video as it posts, against the account's longest. */
function Video({ src, max }: { src: string | null; max: number | null }) {
  const [secs, setSecs] = useState<number | null>(null);
  if (!src) return <span className={HINT}>No video yet.</span>;
  const over = max !== null && secs !== null && secs > max;
  return (
    <div className="grid gap-1.5">
      {/* biome-ignore lint/a11y/useMediaCaption: the client's own video, before it posts */}
      <video
        src={src}
        controls
        preload="metadata"
        onLoadedMetadata={(e) => setSecs(e.currentTarget.duration || null)}
        className="max-h-80 w-fit max-w-full rounded-(--ui-radius) bg-black"
      />
      <span className={over ? WARN : HINT}>
        {secs !== null ? `${Math.ceil(secs)} seconds` : "Length loading"}
        {max !== null ? `; this account posts up to ${max} seconds` : ""}
        {over ? ". Trim it to post here." : ""}
      </span>
    </div>
  );
}

export function TikTokPanel({ values: v, choose, tiktok, video }: TikTokPanelProps) {
  const [said, setSaid] = useState<string | null>(null);
  const c = tiktok?.creator ?? null;
  const pick = async (key: keyof TikTokValues, value: unknown) => {
    setSaid(null);
    setSaid(await choose(key, value));
  };
  const options: readonly TikTokPrivacy[] = c ? c.privacyOptions : TIKTOK_PRIVACY;
  const branded = !!(v.disclose && v.brandedContent);
  const stale = !!(c && v.privacy && !options.includes(v.privacy as TikTokPrivacy));
  const label = tiktokLabel(v);
  const declaration = tiktokDeclaration(v);
  const parts = declaration.text.split(
    new RegExp(`(${declaration.links.map((l) => l.label).join("|")})`),
  );
  return (
    <section aria-label="TikTok" className="grid gap-5 border-t border-(--ui-hair) pt-5">
      <h3 className={GROUP_HEAD}>TikTok</h3>
      <Account tiktok={tiktok} />
      <div className="grid gap-1.5">
        <label htmlFor="tiktok-privacy" className={LABEL}>
          Who can see this post<span className="text-(--ui-bad)"> *</span>
        </label>
        <select
          id="tiktok-privacy"
          className={SELECT}
          value={v.privacy ?? ""}
          onChange={(e) => void pick("privacy", e.target.value || null)}
        >
          <option value="" disabled>
            Pick one
          </option>
          {options.map((o) => (
            <option
              key={o}
              value={o}
              disabled={o === "SELF_ONLY" && branded}
              title={o === "SELF_ONLY" && branded ? TIKTOK_COPY.brandedPrivate : undefined}
            >
              {TIKTOK_PRIVACY_LABELS[o]}
              {o === "SELF_ONLY" && branded ? ` (${TIKTOK_COPY.brandedPrivate})` : ""}
            </option>
          ))}
        </select>
        {stale ? (
          <span className={WARN}>This account can't post that way now. Pick again.</span>
        ) : !v.privacy ? (
          <span className={HINT}>Nothing is picked for you. The post waits until you pick.</span>
        ) : null}
      </div>
      <div className="grid gap-2">
        <span className={LABEL}>Allow users to</span>
        <Check
          id="tiktok-comment"
          label="Comment"
          on={!!v.allowComment}
          off={c?.commentOff ? "Turned off in this account's TikTok settings." : null}
          pick={(on) => void pick("allowComment", on)}
        />
        <Check
          id="tiktok-duet"
          label="Duet"
          on={!!v.allowDuet}
          off={c?.duetOff ? "Turned off in this account's TikTok settings." : null}
          pick={(on) => void pick("allowDuet", on)}
        />
        <Check
          id="tiktok-stitch"
          label="Stitch"
          on={!!v.allowStitch}
          off={c?.stitchOff ? "Turned off in this account's TikTok settings." : null}
          pick={(on) => void pick("allowStitch", on)}
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor="tiktok-disclose" className="flex cursor-pointer items-center gap-2.5">
          <input
            id="tiktok-disclose"
            type="checkbox"
            role="switch"
            aria-checked={!!v.disclose}
            checked={!!v.disclose}
            onChange={(e) => void pick("disclose", e.target.checked)}
            className="size-4 accent-(--ui-accent)"
          />
          <span className="text-[14px]">{TIKTOK_COPY.disclose}</span>
        </label>
        <span className={`${HINT} pl-6.5`}>{TIKTOK_COPY.discloseHint}</span>
        {v.disclose ? (
          <div className="grid gap-2 pl-6.5">
            <Check
              id="tiktok-your-brand"
              label={TIKTOK_COPY.yourBrand}
              hint={TIKTOK_COPY.yourBrandHint}
              on={!!v.yourBrand}
              pick={(on) => void pick("yourBrand", on)}
            />
            <Check
              id="tiktok-branded"
              label={TIKTOK_COPY.brandedContent}
              hint={TIKTOK_COPY.brandedContentHint}
              on={!!v.brandedContent}
              off={v.privacy === "SELF_ONLY" ? TIKTOK_COPY.brandedPrivate : null}
              pick={(on) => void pick("brandedContent", on)}
            />
            {label ? (
              <span className="text-[13px] font-medium">{label}</span>
            ) : (
              <span role="alert" className={WARN}>
                {TIKTOK_COPY.pickOne}
              </span>
            )}
          </div>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <span className={LABEL}>Video</span>
        <Video src={video} max={c?.maxVideoSec ?? null} />
      </div>
      {said ? (
        <span role="alert" className={WARN}>
          {said}
        </span>
      ) : null}
      <div className="grid gap-1 rounded-(--ui-radius) bg-(--ui-wash) px-3 py-2.5">
        <p className="text-[13px]">
          {parts.map((p) => {
            const link = declaration.links.find((l) => l.label === p);
            return link ? (
              <a
                key={p}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {p}
              </a>
            ) : (
              p
            );
          })}
        </p>
        <p className={HINT}>{TIKTOK_COPY.processing}</p>
        <p className={HINT}>Nothing posts until you press Approve.</p>
      </div>
    </section>
  );
}

/** The keys this panel draws; the rest of TikTok's fields stay in the generic form. */
export const TIKTOK_PANEL_KEYS = new Set([
  "privacy",
  "allowComment",
  "allowDuet",
  "allowStitch",
  "disclose",
  "yourBrand",
  "brandedContent",
]);
