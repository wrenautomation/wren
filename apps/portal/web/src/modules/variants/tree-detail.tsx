/** The tree's detail panel: one sample (path, parents, keep, steers) and its batch. */
import { Button, Tag } from "@wren/ui";
import { href, navigate } from "../../route.js";
import { handToChat } from "../agent/drive.js";
import type { TreeSteer } from "./tree.js";
import { type Call, type TNode, type Tree, VERD } from "./tree-model.js";

const TONE = { amazing: "accent", good: "green", bad: "bad", open: "warn" } as const;
export const tone = (v: Call) => (v in TONE ? TONE[v as keyof typeof TONE] : "neutral");

export const Lock = () => (
  <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true">
    <path
      d="M3 5.5V3.75a2.5 2.5 0 0 1 5 0V5.5"
      fill="none"
      stroke="var(--ui-accent)"
      strokeWidth="1.5"
    />
    <rect x=".75" y="5.25" width="9.5" height="6" rx="1.75" fill="var(--ui-accent)" />
  </svg>
);
export const PIN = "M4 1h4l-.6 3.4L9.5 6.5v1h-3V11l-.5.6-.5-.6V7.5h-3v-1l2.1-2.1z";
export const Pin = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    <path d={PIN} fill="currentColor" />
  </svg>
);

export function Poster({ s }: { s: TNode }) {
  if (s.v === "open")
    return s.poster ? (
      <div className="vt-poster to-mark">
        <img src={s.poster} alt={`Snapshot of sample ${s.letter}`} loading="lazy" />
        <span>{s.letter}</span>
      </div>
    ) : (
      <div className="vt-poster blind">{s.letter}</div>
    );
  if (s.poster)
    return (
      <div className="vt-poster">
        <img src={s.poster} alt={`Snapshot of ${s.name}`} loading="lazy" />
      </div>
    );
  return <div className="vt-poster words">{s.body ?? s.change ?? s.name}</div>;
}

export const fromOf = (t: Tree, s: TNode) =>
  s.p.length
    ? s.p.map((i) => t.byId.get(i)?.name ?? `sample ${i}`).join(" × ")
    : s.r === 1
      ? "the brief"
      : "a new seed";

function LinkTo({ s, onGo }: { s: TNode; onGo: (id: number) => void }) {
  return (
    <button type="button" className="vt-link" onClick={() => onGo(s.id)}>
      <i className={`vt-dot ${s.v}`} />
      {s.name}
    </button>
  );
}

export function SampleDetail({
  t,
  s,
  round,
  kept,
  onGo,
  onKeep,
  subject,
  only,
  onOnly,
  folded,
  onFold,
  steer,
}: {
  t: Tree;
  s: TNode;
  round: Tree["rounds"][number];
  kept: boolean;
  onGo: (id: number) => void;
  onKeep: () => void;
  subject: string;
  /** the tree shows only this sample's line */
  only: boolean;
  onOnly: () => void;
  folded: boolean;
  onFold: () => void;
  /** steer controls; none when the host gives no steers */
  steer?: SteerCtl | undefined;
}) {
  if (s.v === "open")
    return (
      <>
        <Poster s={s} />
        <div className="vt-row">
          <h3>{s.name}</h3>
          <Tag>Batch {t.rounds[s.r - 1]?.num ?? s.r}</Tag>
          <Tag tone="needs">To mark</Tag>
        </div>
        <div>
          <div className="vt-k">What it is</div>
          <div className="vt-v q">
            Blind until you hand the batch back. Its idea and parents show then.
          </div>
        </div>
        <div className="vt-row">
          <Button
            tone="primary"
            onClick={() => navigate(href("/variants/batches", { batch: round.id }))}
          >
            Mark batch {s.r}
          </Button>
        </div>
      </>
    );
  const pu = t.pathUp(s.id);
  const ch = t.kids(s.id);
  return (
    <>
      <Poster s={s} />
      <div className="vt-row">
        <h3>{s.name}</h3>
        <Tag>Batch {t.rounds[s.r - 1]?.num ?? s.r}</Tag>
        <Tag tone={tone(s.v)}>{VERD[s.v]}</Tag>
        {kept && (
          <Tag tone="accent">
            <Pin />
            Kept
          </Tag>
        )}
        {steer?.pin && <Tag tone="accent">Grows next</Tag>}
        {steer?.pruned && <Tag tone="bad">Pruned</Tag>}
      </div>
      <div>
        <div className="vt-k">Path</div>
        <div className="vt-path">
          <span>Brief</span>
          {pu.map((x) => (
            <span key={x.id} className="contents">
              <span className="sep">›</span>
              {x.id === s.id ? (
                <span className="here">{x.name}</span>
              ) : (
                <button type="button" className="vt-plain" onClick={() => onGo(x.id)}>
                  {x.name}
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      {s.change && (
        <div>
          <div className="vt-k">What it tested</div>
          <div className="vt-v">{s.change}</div>
        </div>
      )}
      {s.notes.length > 0 && (
        <div>
          <div className="vt-k">Your note on it</div>
          {s.notes.map((n) => (
            <div key={n} className="vt-v q">
              {n}
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="vt-k">Came from</div>
        <div className="vt-row">
          {s.p.length ? (
            s.p.flatMap((id) => {
              const x = t.byId.get(id);
              if (!x) return [];
              const took = s.took[id];
              return [
                <span key={id} className="vt-from">
                  <LinkTo s={x} onGo={onGo} />
                  {took && <span className="vt-hint">took {took}</span>}
                </span>,
              ];
            })
          ) : (
            <span className="vt-v q">{s.r === 1 ? "Seed from the brief" : "New seed"}</span>
          )}
        </div>
      </div>
      <div>
        <div className="vt-k">Led to</div>
        <div className="vt-row">
          {ch.length ? (
            ch.map((x) => <LinkTo key={x.id} s={x} onGo={onGo} />)
          ) : (
            <span className="vt-v q">Nothing yet</span>
          )}
        </div>
      </div>
      <div className="vt-row">
        <Button icon="pin" onClick={onKeep} aria-pressed={kept}>
          {kept ? "Kept" : "Keep"}
        </Button>
        <Button
          onClick={() =>
            handToChat(
              "vireo",
              `Branch from ${s.name} (sample ${s.id}, ${subject})\nMake the next batch with sample ${s.id} as the parent.`,
            )
          }
        >
          Branch from this
        </Button>
        <Button aria-pressed={only} onClick={onOnly}>
          {only ? "Show all" : "Only this line"}
        </Button>
        {(ch.length > 0 || folded) && (
          <Button aria-pressed={folded} onClick={onFold}>
            {folded ? "Unfold" : "Fold what grew"}
          </Button>
        )}
        {s.media && (
          <a className="vt-link" href={s.media} target="_blank" rel="noreferrer">
            Open sample ↗
          </a>
        )}
      </div>
      {steer && <SteerRow s={s} c={steer} />}
    </>
  );
}

interface SteerCtl {
  pin: TreeSteer | undefined;
  prune: TreeSteer | undefined;
  pruned: boolean;
  /** a cross waits on its second sample: the first one's name */
  crossFrom: string | null;
  busy: boolean;
  set: (kind: "pin" | "prune" | "cross") => void;
  lift: (id: number) => void;
}

/** his steers on one sample: what the next batch must do with it */
function SteerRow({ s, c }: { s: TNode; c: SteerCtl }) {
  const cut = c.pruned && !c.prune;
  return (
    <div>
      <div className="vt-k">Next batch</div>
      <div className="vt-row">
        {c.crossFrom && !c.pruned && (
          <Button tone="primary" disabled={c.busy} onClick={() => c.set("cross")}>
            Cross with {c.crossFrom}
          </Button>
        )}
        <Button
          aria-pressed={!!c.pin}
          disabled={c.busy || c.pruned}
          onClick={() => (c.pin ? c.lift(c.pin.id) : c.set("pin"))}
        >
          {c.pin ? "Growing from this" : "Always grow from this"}
        </Button>
        {!c.crossFrom && (
          <Button disabled={c.busy || c.pruned} onClick={() => c.set("cross")}>
            Cross with…
          </Button>
        )}
        <Button
          aria-pressed={!!c.prune}
          disabled={c.busy || cut}
          onClick={() => (c.prune ? c.lift(c.prune.id) : c.set("prune"))}
        >
          {c.prune ? "Pruned" : "Prune"}
        </Button>
        {cut && <span className="vt-hint">A sample above {s.name} is pruned.</span>}
      </div>
    </div>
  );
}

export function BatchDetail({ t, n }: { t: Tree; n: number }) {
  const B = t.rounds[n - 1];
  if (!B) return null;
  const strip = (
    <div className="vt-strip" aria-hidden="true">
      {t.S.filter((s) => s.r === n).map((s) => (
        <i key={s.id} className={s.v} />
      ))}
    </div>
  );
  if (B.open)
    return (
      <>
        <div className="vt-row">
          <h3>
            <a className="vt-ha" href={href("/variants/batches", { batch: B.id })}>
              Batch {B.num}
            </a>
          </h3>
          <Tag tone="needs">To mark</Tag>
          <span className="vt-hint">{B.when}</span>
        </div>
        {strip}
        <div>
          <div className="vt-k">State</div>
          <div className="vt-v q">{B.call}. Each waits for your call.</div>
        </div>
      </>
    );
  return (
    <>
      <div className="vt-row">
        <h3>
          <a className="vt-ha" href={href("/variants/batches", { batch: B.id })}>
            Batch {B.num}
          </a>
        </h3>
        <span className="vt-hint">{B.when}</span>
      </div>
      <div className="vt-row">
        {strip}
        <span className="vt-v q text-[13px]">{B.call}</span>
      </div>
      {B.note && (
        <div>
          <div className="vt-k">Your note on the batch</div>
          <div className="vt-v q">{B.note}</div>
        </div>
      )}
      {B.took && (
        <div>
          <div className="vt-k">What Vireo took from it</div>
          <div className="vt-v q">{B.took}</div>
        </div>
      )}
      {B.locks.length > 0 && (
        <div>
          <div className="vt-k">Guides locked after it</div>
          <ul className="vt-locks">
            {B.locks.map((g) => (
              <li key={g}>
                <Lock />
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
