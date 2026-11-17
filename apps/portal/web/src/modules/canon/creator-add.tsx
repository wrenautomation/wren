/**
 * Add creator (WA-1416 D7): a name or one profile link → the Mac finds every account the person
 * runs, tracks the ones that pass the name rule and lists the rest to tick. The address holds the
 * sheet: `add=new` (the form) or `add=<find id>`, so a reload picks the find up again. The desk's
 * CLI writes the row; the sheet reads it every 2 s while something runs.
 */
import type { FindShown, FindShownCandidate } from "@wren/research/creator-find";
import {
  Button,
  DetailSheet,
  FormKept,
  Icon,
  num,
  PlatformTile,
  RingSlot,
  Tag,
  type TagTone,
  TextField,
  useEditForm,
  usePhone,
} from "@wren/ui";
import { useEffect, useId, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { ERROR, QUIET } from "../work/bits.js";
import { cn, followersText, platformName } from "./post-parts.js";

const ORDER = ["youtube", "x", "instagram", "tiktok", "threads", "linkedin"];
const POLL_MS = 2000;
const STEPS: Record<string, string> = {
  searching: "Searching the web",
  picking: "Picking the accounts",
  "reading the link": "Reading the link",
};
const TONE: Record<FindShownCandidate["label"], TagTone> = {
  main: "accent",
  alternate: "accent",
  fan: "neutral",
  "other person": "neutral",
  "not a profile": "neutral",
};
const FADE = "animate-in fade-in duration-150";

const keyOf = (c: Pick<FindShownCandidate, "platform" | "handle">) => `${c.platform}:${c.handle}`;
/** shown rows: tracked first, then main, alternate, fan, other person */
const RANK = ["main", "alternate", "fan", "other person"];
const rowsOf = (cands: FindShownCandidate[]) =>
  cands
    .filter((c) => c.label !== "not a profile" || c.tracked)
    .sort(
      (a, b) =>
        ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform) ||
        Number(!a.tracked) - Number(!b.tracked) ||
        RANK.indexOf(a.label) - RANK.indexOf(b.label),
    );
/** a tracked row still waiting for its first read */
const reading = (c: FindShownCandidate) =>
  !!c.tracked && !!c.read?.active && !c.read.readAt && !c.read.readError;
const running = (f: FindShown | null | undefined) =>
  !!f && (f.state === "waiting" || f.state === "finding" || f.candidates.some(reading));

export function AddCreator({
  at,
  niche,
  go,
  onTracked,
}: {
  /** `new`, or a find's id */
  at: string;
  /** the niche in the address, the field's default */
  niche: string | null;
  go: (at: string | null) => void;
  /** a creator was tracked or removed: the feed reads again */
  onTracked: () => void;
}) {
  const id = /^\d+$/.test(at) ? Number(at) : null;
  const got = useCall(
    id ? `creator-find:${id}` : null,
    () => call<FindShown>("canon/creatorFindShow", { id }),
    { kept: false },
  );
  const f = got.data;
  const { retry } = got;
  const live = running(f);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(retry, POLL_MS);
    return () => clearInterval(t);
  }, [live, retry]);
  // the find just tracked its own: the feed reads again, once
  const told = useRef<number | null>(null);
  useEffect(() => {
    if (f?.state !== "found" || told.current === f.id) return;
    told.current = f.id;
    onTracked();
  }, [f?.state, f?.id, onTracked]);

  const form = useEditForm({
    key: "canon:creator-find",
    defaults: { input: "", niche: niche ?? "" },
  });
  const busy = form.formState.isSubmitting;
  const find = async (input: string, n: string) => {
    const shown = await call<FindShown>("canon/creatorFind", { input, niche: n });
    go(String(shown.id));
  };
  const send = form.onSend(async (v) => {
    const input = v.input.trim();
    const n = v.niche.trim();
    if (input.length < 2) throw new Error("Type a name or paste a profile link.");
    if (!n) throw new Error("Give the niche these accounts go under.");
    await find(input, n);
  });

  return (
    <DetailSheet
      title="Add creator"
      about="Find every account one creator runs and track them"
      onClose={() => go(null)}
    >
      <h2 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">Add creator</h2>
      <p className={cn("mt-1 mb-5", QUIET)}>
        Finds their accounts on YouTube, X, Instagram, TikTok, Threads and LinkedIn.
      </p>
      {id == null ? (
        <form className="grid gap-3" onSubmit={(e) => void send(e)}>
          <FormKept form={form} />
          <TextField
            form={form}
            name="input"
            label="Name or profile link"
            placeholder="Alex Hormozi, or youtube.com/@name"
            autoComplete="off"
            maxLength={500}
            autoFocus
          />
          <TextField form={form} name="niche" label="Niche" maxLength={80} />
          {form.error && (
            <p role="alert" className={cn("m-0", ERROR, FADE)}>
              {form.error}
            </p>
          )}
          <div>
            <Button type="submit" tone="primary" busy={busy}>
              Find
            </Button>
          </div>
        </form>
      ) : !f ? (
        got.error ? (
          <Failed why={got.error.message} again={retry} label="Load again" />
        ) : (
          <p className={QUIET}>Loading…</p>
        )
      ) : (
        <Found
          f={f}
          go={go}
          again={() => find(f.input, f.niche)}
          reload={retry}
          onTracked={onTracked}
        />
      )}
    </DetailSheet>
  );
}

function Failed({
  why,
  again,
  label = "Try again",
}: {
  why: string;
  again: () => unknown;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-3" role="alert">
      <p className={cn("m-0", ERROR)}>{why}</p>
      {err && <p className={cn("m-0", ERROR)}>{err}</p>}
      <div>
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await again();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}

function Found({
  f,
  go,
  again,
  reload,
  onTracked,
}: {
  f: FindShown;
  go: (at: string | null) => void;
  again: () => Promise<void>;
  reload: () => void;
  onTracked: () => void;
}) {
  const who = f.name ?? f.input;
  if (f.state === "failed") return <Failed why={f.error ?? "The find failed"} again={again} />;
  if (f.state !== "found")
    return (
      <p className="m-0 flex items-center gap-2 [--ui-gap:8px] text-[14px]" aria-live="polite">
        <span key={f.step ?? f.state} className={FADE}>
          {f.state === "waiting"
            ? `Waits for the Mac: ${who}`
            : `${(f.step && STEPS[f.step]) ?? f.step ?? "Starting"}: ${who}`}
        </span>
        <RingSlot on />
      </p>
    );
  const rows = rowsOf(f.candidates);
  const hidden = f.candidates.length - rows.length;
  if (!rows.length)
    return (
      <div className="grid gap-3">
        <p className="m-0 text-[14px]">
          No accounts found for {who}. Try one of their profile links.
        </p>
        <div>
          <Button onClick={() => go("new")}>Start over</Button>
        </div>
      </div>
    );
  return <Picks f={f} rows={rows} hidden={hidden} reload={reload} onTracked={onTracked} />;
}

function Picks({
  f,
  rows,
  hidden,
  reload,
  onTracked,
}: {
  f: FindShown;
  rows: FindShownCandidate[];
  hidden: number;
  reload: () => void;
  onTracked: () => void;
}) {
  const phone = usePhone();
  // alternates come ticked: one Track adds them (D3)
  const [ticks, setTicks] = useState<Set<string>>(
    () => new Set(rows.filter((c) => !c.tracked && c.label === "alternate").map(keyOf)),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = (k: string) =>
    setTicks((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const picks = rows.filter((c) => !c.tracked && ticks.has(keyOf(c)));
  const tracked = rows.filter((c) => c.tracked).length;
  const track = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call("canon/creatorTrack", {
        id: f.id,
        picks: picks.map(({ platform, handle }) => ({ platform, handle })),
      });
      setTicks(new Set());
      reload();
      onTracked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      <p className="m-0 text-[14px]">
        {tracked
          ? `${num(tracked)} ${tracked === 1 ? "account" : "accounts"} of ${f.name ?? f.input} tracked.`
          : `Nothing tracked yet for ${f.name ?? f.input}.`}{" "}
        <span className={QUIET}>Tick more to track them too.</span>
      </p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((c, i) => (
          <Row
            key={keyOf(c)}
            c={c}
            head={rows[i - 1]?.platform !== c.platform}
            ticked={ticks.has(keyOf(c))}
            flip={() => flip(keyOf(c))}
            removed={() => {
              reload();
              onTracked();
            }}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <p className={cn("m-0", QUIET)}>
          {num(hidden)} {hidden === 1 ? "result was" : "results were"} not a profile.
        </p>
      )}
      {err && (
        <p role="alert" className={cn("m-0", ERROR)}>
          {err}
        </p>
      )}
      {/* over the rows' own z-[1] links and buttons; phone sheet pads its scroller 96px, so pull over it */}
      <div
        className={cn(
          "sticky z-[2] -mx-1 bg-(--ui-paper) px-1 pt-2",
          // rows fade under the bar, never cut mid-line
          "before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-(--ui-paper) before:to-transparent",
          phone
            ? "bottom-[calc(-96px-env(safe-area-inset-bottom))] pb-[calc(104px+env(safe-area-inset-bottom))]"
            : "bottom-0 pb-2",
        )}
      >
        <Button tone="primary" busy={busy} disabled={!picks.length} onClick={() => void track()}>
          {picks.length ? `Track ${num(picks.length)}` : "Track"}
        </Button>
      </div>
    </div>
  );
}

function Row({
  c,
  head,
  ticked,
  flip,
  removed,
}: {
  c: FindShownCandidate;
  head: boolean;
  ticked: boolean;
  flip: () => void;
  removed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useId();
  const failed = c.read?.readError ?? null;
  const remove = async () => {
    if (c.creatorId == null) return;
    setBusy(true);
    try {
      await call("canon/creatorRemove", { creatorId: c.creatorId });
      removed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const line = [followersText(c.followers)].filter(Boolean).join(" · ");
  return (
    <li className={FADE}>
      {head && (
        <h3 className="mt-3 mb-1 flex items-center gap-2 text-[13px] font-semibold text-(--ui-ink-2)">
          <PlatformTile mark={c.platform} />
          {platformName(c.platform)}
        </h3>
      )}
      {/* the row is the tick's hit area; the profile opens from its own icon */}
      <div
        className={cn(
          "relative flex items-start gap-3 rounded-(--ui-radius) px-2 py-2",
          !c.tracked && "hover:bg-(--ui-hover)",
        )}
      >
        {/* one marker column: check and tick share it */}
        <span className="mt-0.5 grid size-5 flex-none place-items-center">
          {c.tracked ? (
            <Icon name="check" className="size-4 text-(--ui-good)" />
          ) : (
            <input
              id={box}
              type="checkbox"
              checked={ticked}
              onChange={flip}
              className="m-0 accent-(--ui-active)"
            />
          )}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {c.tracked ? (
              <span className="font-semibold wrap-anywhere">{c.name ?? c.handle}</span>
            ) : (
              <label
                htmlFor={box}
                className="cursor-pointer font-semibold wrap-anywhere after:absolute after:inset-0"
              >
                {c.name ?? c.handle}
              </label>
            )}
            <span className="text-[13px] wrap-anywhere text-(--ui-ink-2)">
              @{c.handle.replace(/^@/, "")}
            </span>
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${c.name ?? c.handle} on ${platformName(c.platform)}`}
              className="relative z-[1] inline-grid size-6 place-items-center rounded-(--ui-radius) text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
            >
              <Icon name="external" className="size-3.5" />
            </a>
            <Tag tone={TONE[c.label]}>{c.label}</Tag>
            {c.tracked && !failed && (
              <Tag tone="green" busy={reading(c)}>
                {reading(c) ? "Reading" : "Tracked"}
              </Tag>
            )}
          </span>
          {line && <span className="text-[13px] text-(--ui-ink-2)">{line}</span>}
          <span className="text-[13px] text-(--ui-ink-2)">{c.why}</span>
          {failed && (
            <span className="relative z-[1] mt-1 flex flex-wrap items-center gap-2">
              <span className={ERROR}>Can't read it: {failed}</span>
              <Button size="dense" tone="quiet" busy={busy} onClick={() => void remove()}>
                Remove
              </Button>
            </span>
          )}
          {err && <span className={ERROR}>{err}</span>}
        </span>
      </div>
    </li>
  );
}
