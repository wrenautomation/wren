/**
 * The Shop's art, drawn as code: one small set of scenes, each the thing a part makes (an inbox, a
 * text thread, a booked slot, a lead sheet), on a 240 by 120 board. Every color is a token, so a
 * scene reads the same by day and by night; `--art` is the part's stage tint, its one hue.
 */
import { Icon, type IconName } from "@wren/ui";
import { VendorMark } from "@wren/ui/vendor-marks";
import type { CSSProperties, ReactNode } from "react";

export type Scene =
  | "inbox"
  | "thread"
  | "texts"
  | "cadence"
  | "calendar"
  | "sheet"
  | "post"
  | "comments"
  | "connect"
  | "chart"
  | "doc"
  | "board"
  | "call"
  | "review"
  | "page"
  | "flow"
  | "glyph";

/** What a scene draws: its variant, the platform inside it, a cadence's days, a flow's steps. */
export interface Spec {
  scene: Scene;
  v?: string;
  /** A vendor the scene shows in place (the post's network, the ad's): a `VendorMark` key. */
  on?: string;
  days?: number[];
  via?: IconName[];
  icon?: string;
}

const ink = (pct: number) => `color-mix(in srgb, var(--ui-ink) ${pct}%, transparent)`;
const tint = (pct: number) => `color-mix(in srgb, var(--art) ${pct}%, var(--ui-paper))`;
const fill = (c: string): { style: CSSProperties } => ({ style: { fill: c } });
const stroke = (c: string, w = 1): { style: CSSProperties } => ({
  style: { fill: "none", stroke: c, strokeWidth: w },
});

const PAPER = "var(--ui-paper)";
const ART = "var(--art)";

/** A raised sheet: paper, a hairline, and a soft drop under it. */
function Sheet({
  x,
  y,
  w,
  h,
  r = 6,
  bg = PAPER,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  bg?: string;
}) {
  return (
    <>
      <rect x={x} y={y + 2} width={w} height={h} rx={r} {...fill(ink(5))} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        style={{ fill: bg, stroke: ink(16), strokeWidth: 0.75 }}
      />
    </>
  );
}

/** A line of text, as a bar: `k` is how strong (1 faint, 2 body, 3 a name). */
function Text({
  x,
  y,
  w,
  k = 2,
  c,
}: {
  x: number;
  y: number;
  w: number;
  k?: 1 | 2 | 3;
  c?: string;
}) {
  const h = k === 3 ? 4.5 : 3.5;
  return (
    <rect
      x={x}
      y={y - h / 2}
      width={w}
      height={h}
      rx={h / 2}
      {...fill(c ?? ink(k === 3 ? 30 : k === 2 ? 15 : 9))}
    />
  );
}

/** A kit icon at (x, y), `s` wide, in `c`. */
function Ico({
  name,
  x,
  y,
  s = 12,
  c = ink(60),
}: {
  name: IconName;
  x: number;
  y: number;
  s?: number;
  c?: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`} style={{ color: c }}>
      <Icon name={name} size={s} />
    </g>
  );
}

/** A vendor's mark at (x, y). */
function Mark({ on, x, y, s = 12 }: { on: string; x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <VendorMark vendor={on} size={s} />
    </g>
  );
}

/** A person: a round head, or the network's mark in a ring when `on` names one. */
function Face({
  x,
  y,
  r = 5,
  on,
  c,
}: {
  x: number;
  y: number;
  r?: number;
  on?: string | undefined;
  c?: string;
}) {
  if (on)
    return (
      <>
        <circle
          cx={x}
          cy={y}
          r={r + 0.5}
          style={{ fill: PAPER, stroke: ink(14), strokeWidth: 0.75 }}
        />
        <Mark on={on} x={x - r * 0.62} y={y - r * 0.62} s={r * 1.24} />
      </>
    );
  return <circle cx={x} cy={y} r={r} {...fill(c ?? ink(14))} />;
}

/** A small round badge with an icon: what happened ("sent", "booked"). */
function Badge({
  name,
  x,
  y,
  c = ART,
  r = 7,
}: {
  name: IconName;
  x: number;
  y: number;
  c?: string;
  r?: number;
}) {
  return (
    <>
      <circle cx={x} cy={y} r={r} {...fill(c)} />
      <Ico name={name} x={x - r * 0.6} y={y - r * 0.6} s={r * 1.2} c="var(--ui-paper)" />
    </>
  );
}

function Inbox({ v }: Spec) {
  const rows = [0, 1, 2];
  const labels = [ART, "var(--ui-cue-6)", "var(--ui-cue-2)"];
  return (
    <>
      <Sheet x={46} y={14} w={148} h={96} />
      <rect x={46} y={14} width={148} height={16} rx={6} {...fill(ink(4))} />
      <Ico name="inbox" x={53} y={17} s={10} c={ink(45)} />
      <Text x={68} y={22} w={34} k={1} />
      {rows.map((i) => {
        const y = 36 + i * 24;
        const on = i === 0;
        return (
          <g key={i}>
            {on ? (
              <rect x={49} y={y - 2} width={142} height={22} rx={4} {...fill(tint(14))} />
            ) : null}
            <Face x={60} y={y + 9} r={5} {...(on ? { c: tint(55) } : {})} />
            <Text x={71} y={y + 5} w={on ? 38 : 30} k={3} />
            <Text x={71} y={y + 13} w={i === 1 ? 70 : 88} k={on ? 2 : 1} />
            {v === "sent" ? (
              <Ico name="check" x={176} y={y + 3} s={10} c={on ? ART : ink(35)} />
            ) : v === "sort" ? (
              <rect x={160} y={y + 3} width={24} height={7} rx={3.5} {...fill(labels[i] ?? ART)} />
            ) : on ? (
              <circle cx={182} cy={y + 9} r={2.5} {...fill(ART)} />
            ) : null}
          </g>
        );
      })}
    </>
  );
}

function Thread() {
  return (
    <>
      <Sheet x={40} y={16} w={118} h={50} />
      <Face x={52} y={28} r={5} />
      <Text x={62} y={28} w={36} k={3} />
      <Text x={48} y={42} w={98} />
      <Text x={48} y={50} w={80} />
      <Text x={48} y={58} w={54} k={1} />
      <Sheet x={82} y={56} w={118} h={50} bg={tint(14)} />
      <Ico name="reply" x={92} y={64} s={11} c={ART} />
      <Text x={108} y={70} w={40} k={3} />
      <Text x={90} y={84} w={100} />
      <Text x={90} y={92} w={72} />
    </>
  );
}

/** A phone with a text thread; `back` opens on a missed call, `form` on a form's answer. */
function Texts({ v, on }: Spec) {
  const out = on === "whatsapp" ? "color-mix(in srgb, #25d366 30%, var(--ui-paper))" : tint(40);
  return (
    <>
      <rect
        x={80}
        y={8}
        width={80}
        height={124}
        rx={14}
        style={{ fill: PAPER, stroke: ink(22), strokeWidth: 1.25 }}
      />
      <rect x={106} y={13} width={28} height={5} rx={2.5} {...fill(ink(14))} />
      {on ? <Mark on={on} x={87} y={24} s={9} /> : null}
      {v === "back" ? (
        <>
          <rect x={88} y={26} width={64} height={18} rx={9} {...fill("var(--ui-warn-tint)")} />
          <Ico name="phone" x={94} y={30} s={10} c="var(--ui-warn)" />
          <Text x={108} y={35} w={36} c="color-mix(in srgb, var(--ui-warn) 45%, transparent)" />
        </>
      ) : (
        <>
          <rect x={88} y={28} width={46} height={16} rx={8} {...fill(ink(9))} />
          <Text x={94} y={36} w={32} k={1} c={ink(22)} />
        </>
      )}
      <rect x={106} y={50} width={46} height={22} rx={9} {...fill(out)} />
      <Text x={112} y={58} w={34} c={ink(28)} />
      <Text x={112} y={65} w={22} c={ink(28)} />
      {v === "form" ? (
        <>
          <rect x={88} y={78} width={52} height={20} rx={8} {...fill(ink(9))} />
          <Ico name="check" x={93} y={83} s={10} c="var(--ui-good)" />
          <Text x={106} y={88} w={28} k={1} c={ink(22)} />
        </>
      ) : (
        <>
          <rect x={88} y={78} width={38} height={16} rx={8} {...fill(ink(9))} />
          <Text x={94} y={86} w={24} k={1} c={ink(22)} />
        </>
      )}
      <rect x={120} y={102} width={32} height={14} rx={7} {...fill(out)} />
      <circle cx={130} cy={109} r={1.5} {...fill(ink(40))} />
      <circle cx={136} cy={109} r={1.5} {...fill(ink(40))} />
      <circle cx={142} cy={109} r={1.5} {...fill(ink(40))} />
    </>
  );
}

/** Touches on a track by day: each a channel, the last one the booking. */
function Cadence({ days = [0, 3, 7], via = ["mail"], v }: Spec) {
  const x0 = 56;
  const x1 = 184;
  const max = Math.max(...days, 1);
  const at = (d: number) => x0 + (d / max) * (x1 - x0);
  const wake = v === "wake";
  const start = wake ? x0 + 34 : x0;
  const xs = wake
    ? days.map((d, i) => (i === 0 ? x0 : start + (d / max) * (x1 - start)))
    : days.map(at);
  return (
    <>
      <line x1={x0} y1={70} x2={start} y2={70} {...stroke(ink(22), 1.25)} strokeDasharray="2 4" />
      <line x1={start} y1={70} x2={x1} y2={70} {...stroke(ink(22), 1.25)} />
      <line x1={start} y1={70} x2={xs[xs.length - 1] ?? x1} y2={70} {...stroke(ART, 2)} />
      {xs.map((x, i) => {
        const name = via[i % via.length] ?? "mail";
        const last = i === xs.length - 1;
        const faded = wake && i === 0;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
          <g key={i}>
            <circle
              cx={x}
              cy={70}
              r={13}
              style={{
                fill: faded ? ink(6) : last ? ART : PAPER,
                stroke: faded ? ink(20) : ART,
                strokeWidth: 1.25,
              }}
            />
            <Ico
              name={faded ? "clock" : name}
              x={x - 6}
              y={64}
              s={12}
              c={faded ? ink(40) : last ? "var(--ui-paper)" : ART}
            />
            {wake && i === 0 ? null : (
              <text
                x={x}
                y={46}
                textAnchor="middle"
                fontSize={8.5}
                style={{ fill: ink(55), fontFamily: "var(--ui-font)", fontWeight: 600 }}
              >
                {`Day ${days[i]}`}
              </text>
            )}
          </g>
        );
      })}
      {wake ? (
        <text
          x={x0}
          y={46}
          textAnchor="middle"
          fontSize={8.5}
          style={{ fill: ink(45), fontFamily: "var(--ui-font)", fontWeight: 600 }}
        >
          Old
        </text>
      ) : null}
    </>
  );
}

function Calendar({ v }: Spec) {
  const cols = [0, 1, 2, 3, 4];
  return (
    <>
      <Sheet x={50} y={12} w={140} h={98} />
      <Ico name="calendar" x={58} y={18} s={10} c={ink(45)} />
      <Text x={73} y={23} w={30} k={3} />
      {cols.map((c) => (
        <g key={c}>
          <Text x={60 + c * 26} y={38} w={14} k={1} />
          {[0, 1, 2].map((r) => (
            <rect
              key={r}
              x={56 + c * 26}
              y={46 + r * 20}
              width={22}
              height={16}
              rx={3}
              {...fill(ink(4))}
            />
          ))}
        </g>
      ))}
      <rect x={108} y={66} width={22} height={36} rx={4} {...fill(ART)} />
      <Ico name="check" x={113} y={71} s={12} c="var(--ui-paper)" />
      <rect x={82} y={46} width={22} height={16} rx={3} {...fill(tint(28))} />
      {v === "remind" ? (
        <>
          <Sheet x={150} y={70} w={64} h={34} r={10} bg={tint(14)} />
          <Ico name="chat" x={158} y={78} s={11} c={ART} />
          <Text x={174} y={82} w={30} />
          <Text x={158} y={95} w={44} k={1} />
        </>
      ) : null}
    </>
  );
}

/** A lead sheet: rows of companies, each checked as it goes. */
function SheetScene({ v }: Spec) {
  const rows = [0, 1, 2, 3];
  const find = v === "find";
  const top = find ? 34 : 14;
  return (
    <>
      {find ? (
        <>
          <Sheet x={56} y={10} w={128} h={18} r={9} />
          <Ico name="search" x={64} y={14} s={10} c={ART} />
          <Text x={80} y={19} w={58} k={2} />
        </>
      ) : null}
      {v === "crawl" ? (
        <>
          <Sheet x={20} y={30} w={44} h={58} r={4} />
          <Ico name="globe" x={26} y={36} s={10} c={ink(45)} />
          <Text x={26} y={56} w={30} k={1} />
          <Text x={26} y={64} w={24} k={1} />
          <Text x={26} y={72} w={32} k={1} />
          <line x1={66} y1={60} x2={78} y2={60} {...stroke(ART, 1.5)} />
          <path d="M75 56l4 4-4 4" {...stroke(ART, 1.5)} />
        </>
      ) : null}
      <Sheet x={v === "crawl" ? 84 : 46} y={top} w={v === "crawl" ? 136 : 148} h={find ? 78 : 96} />
      {(() => {
        const x = v === "crawl" ? 84 : 46;
        const w = v === "crawl" ? 136 : 148;
        return (
          <>
            <rect x={x} y={top} width={w} height={14} rx={6} {...fill(ink(4))} />
            <Text x={x + 10} y={top + 7} w={26} k={1} />
            <Text x={x + 52} y={top + 7} w={20} k={1} />
            {rows.slice(0, find ? 3 : 4).map((i) => {
              const y = top + 22 + i * 19;
              const hot = i === 1;
              return (
                <g key={i}>
                  {hot ? (
                    <rect
                      x={x + 3}
                      y={y - 8}
                      width={w - 6}
                      height={16}
                      rx={3}
                      {...fill(tint(14))}
                    />
                  ) : null}
                  {v === "people" ? (
                    <Face x={x + 13} y={y} r={4.5} {...(hot ? { c: tint(55) } : {})} />
                  ) : (
                    <rect x={x + 9} y={y - 4} width={8} height={8} rx={2} {...fill(ink(12))} />
                  )}
                  <Text x={x + 24} y={y} w={30} k={3} />
                  <Text x={x + 62} y={y} w={w - 100} k={1} />
                  {v === "signals" ? (
                    i % 2 === 1 ? (
                      <Ico name="flag" x={x + w - 20} y={y - 5} s={10} c={ART} />
                    ) : null
                  ) : v === "score" ? (
                    <rect
                      x={x + w - 34}
                      y={y - 2.5}
                      width={[22, 14, 18, 8][i] ?? 10}
                      height={5}
                      rx={2.5}
                      {...fill(ART)}
                    />
                  ) : i === 2 && v === "verify" ? (
                    <Ico name="close" x={x + w - 20} y={y - 5} s={10} c="var(--ui-bad)" />
                  ) : (
                    <Ico
                      name="check"
                      x={x + w - 20}
                      y={y - 5}
                      s={10}
                      c={i === 3 ? ink(25) : "var(--ui-good)"}
                    />
                  )}
                </g>
              );
            })}
          </>
        );
      })()}
    </>
  );
}

/** A post as its feed shows it; `plan` lays three on a week, `video` cuts one. */
function Post({ v, on }: Spec) {
  if (v === "plan")
    return (
      <>
        {[0, 1, 2].map((i) => {
          const x = 36 + i * 58;
          return (
            <g key={i}>
              <Text x={x + 14} y={16} w={22} k={1} />
              <Sheet x={x} y={24 + (i % 2) * 10} w={52} h={70} r={5} />
              <rect
                x={x + 5}
                y={29 + (i % 2) * 10}
                width={42}
                height={28}
                rx={3}
                {...fill(i === 1 ? tint(30) : ink(7))}
              />
              <Text x={x + 6} y={66 + (i % 2) * 10} w={36} k={2} />
              <Text x={x + 6} y={74 + (i % 2) * 10} w={26} k={1} />
              {i === 1 ? <Badge name="clock" x={x + 44} y={34} r={6} /> : null}
            </g>
          );
        })}
      </>
    );
  if (v === "video")
    return (
      <>
        <Sheet x={44} y={10} w={152} h={84} r={6} />
        <rect x={50} y={16} width={140} height={56} rx={4} {...fill(tint(26))} />
        <circle cx={120} cy={44} r={11} {...fill(PAPER)} />
        <path d="M117 38.5v11l9-5.5z" {...fill(ART)} />
        <rect x={50} y={80} width={140} height={6} rx={3} {...fill(ink(8))} />
        <rect x={50} y={80} width={58} height={6} rx={3} {...fill(ART)} />
        <rect x={64} y={100} width={26} height={12} rx={3} {...fill(tint(40))} />
        <rect x={94} y={100} width={44} height={12} rx={3} {...fill(ink(10))} />
        <rect x={142} y={100} width={34} height={12} rx={3} {...fill(tint(40))} />
      </>
    );
  return (
    <>
      <Sheet x={62} y={8} w={116} h={108} r={7} />
      <Face x={75} y={21} r={6} on={on} />
      <Text x={86} y={18} w={34} k={3} />
      <Text x={86} y={25} w={22} k={1} />
      <Text x={70} y={38} w={98} />
      <Text x={70} y={46} w={74} />
      <rect x={70} y={54} width={100} height={42} rx={4} {...fill(tint(26))} />
      {v === "scan" ? (
        <>
          <circle
            cx={150}
            cy={75}
            r={12}
            style={{
              fill: "color-mix(in srgb, var(--ui-paper) 70%, transparent)",
              stroke: ART,
              strokeWidth: 2,
            }}
          />
          <line
            x1={159}
            y1={84}
            x2={166}
            y2={91}
            style={{ stroke: ART, strokeWidth: 3, strokeLinecap: "round" }}
          />
        </>
      ) : (
        <path d="M110 65l14 10-14 10z" {...fill(PAPER)} opacity={0.85} />
      )}
      <circle cx={75} cy={106} r={2.5} {...fill(ink(25))} />
      <Text x={81} y={106} w={12} k={1} />
      <circle cx={104} cy={106} r={2.5} {...fill(ink(25))} />
      <Text x={110} y={106} w={12} k={1} />
    </>
  );
}

function Comments({ v, on }: Spec) {
  return (
    <>
      <Sheet x={36} y={10} w={120} h={40} r={6} />
      <Face x={49} y={23} r={6} on={on} />
      <Text x={60} y={20} w={40} k={3} />
      <Text x={60} y={28} w={84} />
      <Text x={44} y={40} w={70} k={1} />
      <path d="M52 52v44h10" {...stroke(ink(18), 1.25)} />
      <path d="M52 66h10" {...stroke(ink(18), 1.25)} />
      <Sheet x={64} y={56} w={112} h={22} r={11} />
      <Face x={75} y={67} r={5} />
      <Text x={85} y={67} w={70} k={2} />
      {v === "sort" ? (
        <rect x={150} y={63} width={20} height={8} rx={4} {...fill("var(--ui-cue-6)")} />
      ) : null}
      <Sheet x={64} y={84} w={140} h={24} r={12} bg={tint(16)} />
      <Face x={76} y={96} r={5} c={tint(60)} />
      <Text x={86} y={96} w={88} k={2} />
      {v === "find" ? (
        <Badge name="search" x={196} y={30} />
      ) : (
        <Badge name="reply" x={198} y={86} r={6.5} />
      )}
    </>
  );
}

/** A profile with Connect, and the first message under it. */
function Connect({ v, on }: Spec) {
  return (
    <>
      <Sheet x={40} y={12} w={100} h={96} r={8} />
      <rect x={40} y={12} width={100} height={26} rx={8} {...fill(tint(26))} />
      <circle cx={90} cy={40} r={13} style={{ fill: PAPER, stroke: PAPER, strokeWidth: 2 }} />
      <circle cx={90} cy={40} r={11} {...fill(ink(14))} />
      {on ? <Mark on={on} x={98} y={44} s={10} /> : null}
      <Text x={68} y={62} w={44} k={3} />
      <Text x={62} y={71} w={56} k={1} />
      <rect x={62} y={82} width={56} height={14} rx={7} {...fill(ART)} />
      <Ico name="people" x={68} y={84} s={10} c="var(--ui-paper)" />
      <Text x={82} y={89} w={28} c="color-mix(in srgb, var(--ui-paper) 70%, transparent)" />
      <Sheet x={128} y={58} w={82} h={44} r={12} bg={v === "dm" ? tint(16) : PAPER} />
      <Ico name="chat" x={136} y={65} s={10} c={ART} />
      <Text x={150} y={70} w={48} k={2} />
      <Text x={136} y={82} w={62} k={1} />
      <Text x={136} y={90} w={40} k={1} />
    </>
  );
}

function Chart({ v, on }: Spec) {
  if (v === "gauge")
    return (
      <>
        <Sheet x={60} y={12} w={120} h={96} />
        <path d="M84 84a36 36 0 0 1 72 0" {...stroke(ink(10), 8)} strokeLinecap="round" />
        <path d="M84 84a36 36 0 0 1 60-27" {...stroke("var(--ui-good)", 8)} strokeLinecap="round" />
        <circle cx={120} cy={84} r={4} {...fill(ink(50))} />
        <line
          x1={120}
          y1={84}
          x2={140}
          y2={62}
          style={{ stroke: ink(50), strokeWidth: 2, strokeLinecap: "round" }}
        />
        <Ico name="inbox" x={70} y={18} s={10} c={ink(45)} />
        <Text x={85} y={23} w={36} k={3} />
        <Text x={100} y={98} w={40} k={1} />
      </>
    );
  const pts = v === "rank" ? [80, 74, 76, 62, 56, 44, 34] : [78, 70, 72, 58, 62, 46, 38];
  const xs = pts.map((_, i) => 60 + i * 20);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${xs[i]} ${p}`).join("");
  const ad = v === "ad";
  return (
    <>
      {ad ? (
        <>
          <Sheet x={16} y={18} w={64} h={84} r={6} />
          <Face x={27} y={29} r={5} on={on} />
          <Text x={36} y={29} w={30} k={2} />
          <rect x={22} y={40} width={52} height={36} rx={3} {...fill(tint(30))} />
          <Text x={22} y={84} w={44} k={1} />
          <rect x={22} y={90} width={30} height={7} rx={3.5} {...fill(ART)} />
        </>
      ) : null}
      <Sheet x={ad ? 88 : 46} y={14} w={ad ? 136 : 148} h={92} />
      <g transform={ad ? "translate(40 0) scale(0.92 1)" : undefined}>
        {[40, 60, 80].map((y) => (
          <line key={y} x1={56} y1={y} x2={188} y2={y} {...stroke(ink(8), 0.75)} />
        ))}
        {v === "bars" ? null : (
          <path d={`${line}L${xs[xs.length - 1]} 92L${xs[0]} 92Z`} {...fill(tint(22))} />
        )}
        <path d={line} {...stroke(ART, 2)} strokeLinejoin="round" strokeLinecap="round" />
        <circle
          cx={xs[xs.length - 1]}
          cy={pts[pts.length - 1]}
          r={4}
          style={{ fill: PAPER, stroke: ART, strokeWidth: 2 }}
        />
      </g>
      {on && !ad ? <Mark on={on} x={56} y={20} s={11} /> : null}
      <Text x={on && !ad ? 72 : ad ? 98 : 56} y={26} w={30} k={3} />
    </>
  );
}

/** A page: lines, then what makes it count (a signature, a total, a pay button, highlights). */
function Doc({ v }: Spec) {
  if (v === "ledger")
    return (
      <>
        <Sheet x={50} y={12} w={140} h={96} />
        <Ico name="book" x={58} y={18} s={10} c={ink(45)} />
        <Text x={73} y={23} w={34} k={3} />
        {[0, 1, 2, 3].map((i) => {
          const y = 40 + i * 15;
          return (
            <g key={i}>
              <Text x={58} y={y} w={14} k={1} />
              <Text x={78} y={y} w={52} k={2} />
              <rect
                x={150 + (i % 2 ? 10 : 0)}
                y={y - 2.5}
                width={i % 2 ? 22 : 32}
                height={5}
                rx={2.5}
                {...fill(i % 2 ? ink(22) : ART)}
              />
            </g>
          );
        })}
        <line x1={58} y1={98} x2={182} y2={98} {...stroke(ink(14), 0.75)} />
      </>
    );
  const pay = v === "pay";
  return (
    <>
      <Sheet x={80} y={8} w={80} h={112} r={5} />
      <Text x={90} y={22} w={34} k={3} />
      <Text x={90} y={34} w={58} />
      <Text x={90} y={42} w={60} />
      <Text x={90} y={50} w={44} />
      {v === "invoice" || pay ? (
        <>
          {[62, 70, 78].map((y) => (
            <g key={y}>
              <Text x={90} y={y} w={32} k={1} />
              <Text x={136} y={y} w={14} k={2} />
            </g>
          ))}
          <line x1={90} y1={86} x2={150} y2={86} {...stroke(ink(16), 0.75)} />
          <Text x={124} y={94} w={26} k={3} />
          {pay ? (
            <>
              <rect x={90} y={102} width={60} height={12} rx={6} {...fill(ART)} />
              <Ico name="card" x={94} y={103} s={10} c="var(--ui-paper)" />
            </>
          ) : (
            <Badge name="check" x={160} y={94} c="var(--ui-good)" r={9} />
          )}
        </>
      ) : v === "dossier" || v === "read" || v === "facts" ? (
        <>
          <rect x={88} y={58} width={64} height={9} rx={2} {...fill(tint(26))} />
          <Text x={90} y={62.5} w={56} c={ink(28)} />
          <Text x={90} y={74} w={54} />
          <rect x={88} y={80} width={46} height={9} rx={2} {...fill(tint(26))} />
          <Text x={90} y={84.5} w={40} c={ink(28)} />
          <Text x={90} y={96} w={50} />
          {v === "facts" ? (
            <>
              <Ico name="check" x={154} y={57} s={10} c="var(--ui-good)" />
              <Ico name="check" x={138} y={79} s={10} c="var(--ui-good)" />
            </>
          ) : (
            <Badge name={v === "read" ? "book" : "flag"} x={160} y={18} />
          )}
        </>
      ) : v === "brief" || v === "outcome" ? (
        <>
          {[62, 72, 82].map((y, i) => (
            <g key={y}>
              <rect
                x={90}
                y={y - 3.5}
                width={7}
                height={7}
                rx={2}
                style={{
                  fill: v === "outcome" && i < 2 ? ART : PAPER,
                  stroke: v === "outcome" && i < 2 ? ART : ink(24),
                  strokeWidth: 0.75,
                }}
              />
              <Text x={102} y={y} w={[40, 34, 44][i] ?? 30} />
            </g>
          ))}
          <Badge name={v === "brief" ? "calendar" : "phone"} x={160} y={18} />
        </>
      ) : (
        <>
          <Text x={90} y={62} w={54} />
          <Text x={90} y={70} w={40} />
          <path
            d="M92 94c6-10 9-10 9-3s3 6 8-2 6-6 6 0 4 4 9-1"
            {...stroke(ART, 1.75)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1={90} y1={100} x2={146} y2={100} {...stroke(ink(22), 0.75)} />
          <Badge name="write" x={160} y={92} />
        </>
      )}
    </>
  );
}

function Board({ v }: Spec) {
  if (v === "portal")
    return (
      <>
        <Sheet x={36} y={12} w={168} h={96} />
        <rect x={36} y={12} width={40} height={96} rx={6} {...fill(ink(4))} />
        {[24, 34, 44].map((y) => (
          <Text key={y} x={44} y={y} w={22} k={1} />
        ))}
        <Text x={86} y={26} w={50} k={3} />
        {[0, 1, 2].map((i) => {
          const y = 42 + i * 18;
          const done = i < 2;
          return (
            <g key={i}>
              <rect
                x={84}
                y={y - 7}
                width={110}
                height={14}
                rx={4}
                {...fill(done ? ink(3) : tint(14))}
              />
              {done ? (
                <Badge name="check" x={93} y={y} r={4.5} c="var(--ui-good)" />
              ) : (
                <circle
                  cx={93}
                  cy={y}
                  r={4.5}
                  style={{ fill: PAPER, stroke: ART, strokeWidth: 1.25 }}
                />
              )}
              <Text x={102} y={y} w={[56, 44, 64][i] ?? 40} k={done ? 1 : 2} />
            </g>
          );
        })}
      </>
    );
  const cols = [[26, 18, 22], [22, 18], [20]];
  return (
    <>
      {cols.map((cards, c) => {
        const x = 36 + c * 58;
        return (
          <g key={x}>
            <rect x={x} y={12} width={52} height={98} rx={6} {...fill(ink(4))} />
            <Text x={x + 6} y={21} w={22} k={2} />
            {cards.map((h, i) => {
              const y = 28 + cards.slice(0, i).reduce((a, b) => a + b + 5, 0);
              return <Sheet key={y} x={x + 4} y={y} w={44} h={h} r={4} />;
            })}
          </g>
        );
      })}
      <g transform="rotate(-6 176 70)">
        <Sheet x={150} y={56} w={50} h={26} r={4} bg={tint(22)} />
        <Text x={156} y={65} w={30} k={3} />
        <Text x={156} y={73} w={22} k={1} />
      </g>
      <path d="M140 70q4-8 8-4" {...stroke(ART, 1.25)} strokeDasharray="2 2.5" />
    </>
  );
}

/** A call: a ring and its voice; `now` dials, `voicemail` leaves one. */
function Call({ v }: Spec) {
  const bars = [6, 12, 20, 14, 26, 18, 10, 22, 14, 8];
  return (
    <>
      <circle cx={120} cy={60} r={36} {...fill(tint(12))} />
      <circle cx={120} cy={60} r={26} {...fill(tint(24))} />
      <circle cx={120} cy={60} r={17} {...fill(ART)} />
      <Ico name={v === "voicemail" ? "mic" : "phone"} x={112} y={52} s={16} c="var(--ui-paper)" />
      {bars.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
        <g key={i}>
          <rect
            x={30 + i * 5}
            y={60 - h / 2}
            width={2.5}
            height={h}
            rx={1.25}
            {...fill(i % 3 ? ink(22) : ART)}
          />
          <rect
            x={160 + i * 5}
            y={60 - (bars[9 - i] ?? 6) / 2}
            width={2.5}
            height={bars[9 - i] ?? 6}
            rx={1.25}
            {...fill(i % 3 ? ink(22) : ART)}
          />
        </g>
      ))}
      {v === "now" ? <Badge name="bolt" x={146} y={36} r={8} /> : null}
      {v === "dial" ? <Badge name="list" x={146} y={36} r={8} /> : null}
    </>
  );
}

function Review({ v }: Spec) {
  return (
    <>
      {v === "ask" ? (
        <>
          <Sheet x={20} y={34} w={76} h={30} r={12} bg={tint(16)} />
          <Ico name="chat" x={28} y={42} s={10} c={ART} />
          <Text x={42} y={46} w={42} />
          <Text x={28} y={56} w={50} k={1} />
          <path d="M98 52h16" {...stroke(ART, 1.25)} strokeDasharray="2 2.5" />
        </>
      ) : null}
      <Sheet x={v === "ask" ? 116 : 64} y={16} w={112} h={88} r={8} />
      {(() => {
        const x = v === "ask" ? 116 : 64;
        return (
          <>
            <Face x={x + 14} y={32} r={6} on="google" />
            <Text x={x + 26} y={29} w={36} k={3} />
            <Text x={x + 26} y={36} w={20} k={1} />
            {[0, 1, 2, 3, 4].map((i) => (
              <path
                key={i}
                transform={`translate(${x + 10 + i * 14} 46) scale(0.5)`}
                d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z"
                {...fill(ART)}
              />
            ))}
            <Text x={x + 10} y={70} w={90} />
            <Text x={x + 10} y={78} w={78} />
            <Text x={x + 10} y={86} w={52} k={1} />
          </>
        );
      })()}
    </>
  );
}

/** A browser window: a page, a form, a chat box, a visitor's path, a saved link. */
function Page({ v }: Spec) {
  return (
    <>
      <Sheet x={36} y={10} w={168} h={104} r={7} />
      <rect x={36} y={10} width={168} height={14} rx={7} {...fill(ink(5))} />
      {[44, 51, 58].map((x) => (
        <circle key={x} cx={x} cy={17} r={2} {...fill(ink(20))} />
      ))}
      <rect x={70} y={13.5} width={90} height={7} rx={3.5} {...fill(PAPER)} />
      {v === "form" ? (
        <>
          <Text x={52} y={38} w={60} k={3} />
          {[48, 66].map((y) => (
            <rect
              key={y}
              x={52}
              y={y}
              width={96}
              height={12}
              rx={4}
              style={{ fill: PAPER, stroke: ink(24), strokeWidth: 0.75 }}
            />
          ))}
          <rect x={52} y={86} width={50} height={14} rx={7} {...fill(ART)} />
          <Text x={60} y={93} w={30} c="color-mix(in srgb, var(--ui-paper) 70%, transparent)" />
          <Badge name="check" x={168} y={93} c="var(--ui-good)" />
        </>
      ) : (
        <>
          <Text x={52} y={40} w={80} k={3} />
          <Text x={52} y={50} w={110} />
          <Text x={52} y={58} w={92} />
          <rect
            x={52}
            y={68}
            width={46}
            height={14}
            rx={7}
            {...fill(v === "visitors" ? ink(18) : ART)}
          />
          <rect x={150} y={36} width={42} height={46} rx={4} {...fill(tint(24))} />
          {v === "video" ? <path d="M166 52v14l12-7z" {...fill(PAPER)} /> : null}
          <Text x={52} y={98} w={60} k={1} />
          <Text x={52} y={106} w={40} k={1} />
        </>
      )}
      {v === "chat" ? (
        <>
          <Sheet x={150} y={58} w={62} h={50} r={10} bg={tint(14)} />
          <rect x={156} y={64} width={36} height={10} rx={5} {...fill(PAPER)} />
          <rect x={170} y={78} width={36} height={10} rx={5} {...fill(ART)} />
          <rect x={156} y={92} width={28} height={10} rx={5} {...fill(PAPER)} />
        </>
      ) : null}
      {v === "visitors" ? (
        <>
          <path d="M70 100q30-40 66-26t40-30" {...stroke(ART, 1.5)} strokeDasharray="3 3" />
          <path
            d="M174 40l0 13 3.5-3.5 3 6 2.2-1-3-6 5 0z"
            style={{ fill: "var(--ui-ink)", stroke: PAPER, strokeWidth: 1 }}
          />
        </>
      ) : null}
      {v === "save" ? <path d="M184 10v20l-7-5-7 5V10z" {...fill(ART)} /> : null}
      {v === "offer" ? <Badge name="flag" x={190} y={34} /> : null}
    </>
  );
}

/** A workflow: its steps left to right, the last one what it gets. */
function Flow({ via = ["bolt", "chat", "check"], v }: Spec) {
  const n = via.length;
  const size = n > 3 ? 32 : 36;
  const gap = n > 3 ? 18 : 26;
  const total = n * size + (n - 1) * gap;
  const x0 = 120 - total / 2;
  return (
    <>
      {via.map((name, i) => {
        const x = x0 + i * (size + gap);
        const last = i === n - 1;
        const missed = v === "missed" && i === 0;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing.
          <g key={i}>
            {i ? (
              <>
                <line x1={x - gap + 3} y1={60} x2={x - 4} y2={60} {...stroke(ART, 1.5)} />
                <path d={`M${x - 8} 56.5l4 3.5-4 3.5`} {...stroke(ART, 1.5)} />
              </>
            ) : null}
            <rect x={x} y={60 - size / 2 + 2} width={size} height={size} rx={9} {...fill(ink(6))} />
            <rect
              x={x}
              y={60 - size / 2}
              width={size}
              height={size}
              rx={9}
              style={{ fill: last ? ART : PAPER, stroke: last ? ART : ink(18), strokeWidth: 0.75 }}
            />
            <Ico
              name={name}
              x={x + size / 2 - 8}
              y={52}
              s={16}
              c={last ? "var(--ui-paper)" : missed ? "var(--ui-warn)" : ART}
            />
            {missed ? (
              <Badge name="close" x={x + size - 2} y={60 - size / 2 + 2} r={6} c="var(--ui-warn)" />
            ) : null}
          </g>
        );
      })}
    </>
  );
}

function Glyph({ icon }: Spec) {
  return (
    <>
      <circle cx={120} cy={60} r={40} {...fill(tint(10))} />
      <circle cx={120} cy={60} r={27} {...fill(tint(22))} />
      <Ico name={(icon ?? "apps") as IconName} x={106} y={46} s={28} c={ART} />
    </>
  );
}

const SCENES: Record<Scene, (s: Spec) => ReactNode> = {
  inbox: Inbox,
  thread: Thread,
  texts: Texts,
  cadence: Cadence,
  calendar: Calendar,
  sheet: SheetScene,
  post: Post,
  comments: Comments,
  connect: Connect,
  chart: Chart,
  doc: Doc,
  board: Board,
  call: Call,
  review: Review,
  page: Page,
  flow: Flow,
  glyph: Glyph,
};

/** A scene on its board, scaled to the height it's given and centered. */
export function SceneArt({ spec, label }: { spec: Spec; label: string }) {
  const Draw = SCENES[spec.scene];
  return (
    <svg
      viewBox="0 0 240 120"
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full"
      role="img"
      aria-label={label}
    >
      <Draw {...spec} />
    </svg>
  );
}
