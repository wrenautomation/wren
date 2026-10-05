/**
 * An email in the Emails queue: the draft first, each line written from the brief able to show
 * why, then what it cites. Approve undoes for 10 seconds; Don't send asks, since it can't.
 */
import {
  type Action,
  Cited,
  MessagePreview,
  marksOf,
  type RecordExtras,
  Traced,
  Trail,
  useSourcePick,
} from "@wren/ui";
import { useState } from "react";
import type { EmailRow, WhyLine } from "../../api.js";
import type { ListPage } from "../../module.js";
import { cardOf, SourceCards } from "./bits.js";
import { at } from "./nav.js";

type EmailDetail = Pick<
  EmailRow,
  "personId" | "to" | "from" | "opener" | "followup" | "why" | "sources"
>;

const AWAITING = { status: ["awaiting"] };
const said = (verb: string) => (answer: unknown) => {
  const n = (answer as { done?: unknown[] }).done?.length ?? 0;
  return n ? `${verb} ${n === 1 ? "1 email" : `${n} emails`}` : "Already decided";
};

export const EMAIL_ACTIONS: Action[] = [
  {
    id: "reactivation.approve",
    label: "Approve",
    handler: "reactivation/approve",
    undo: "reactivation/unapprove",
    key: "a",
    bulk: true,
    when: AWAITING,
    sets: { status: "approved" },
    done: said("Approved"),
  },
  {
    id: "reactivation.skip",
    label: "Don't send",
    handler: "reactivation/skip",
    confirm: "Don't send this email? We won't write to them again.",
    key: "s",
    bulk: true,
    when: AWAITING,
    sets: { status: "skipped" },
    done: said("Skipped"),
  },
];

export const EMAIL_EMPTY = {
  approve: "Drafts wait here for your OK. New ones arrive when research finds a reason to write.",
  approved: "Approved emails wait here until they go out.",
  sent: "Emails show here once they go out.",
  skipped: "Emails you chose not to send show here.",
};

/** An email or a reply, as it reads in an inbox. */
export const MAIL = "bg-(--ui-wash) px-4 py-3.5";
export const MAIL_BODY =
  "max-w-[72ch] text-[14.5px] leading-[1.6] whitespace-pre-wrap [&>*+*]:mt-[0.75em]";

const nameOf = (c: unknown) =>
  c && typeof c === "object" && "name" in c ? String(c.name) : typeof c === "string" ? c : "";

export const emailExtras: NonNullable<ListPage["extras"]> = (detail, { row }) => {
  const d = detail as EmailDetail;
  const first = nameOf(row.name).split(" ")[0];
  return {
    lead: <Draft key={String(row.id)} d={d} subject={row.subject} first={first} />,
    facts: [
      ["From", d.from],
      ["To", d.to],
    ],
    sources: d.sources.map(cardOf),
  } satisfies RecordExtras;
};

/** The old Emails page's `?filter=` lands on its view. */
export const emailLegacy: NonNullable<ListPage["legacy"]> = (params) => {
  const f = params.get("filter");
  if (f === null) return null;
  const view = { approved: "approved", sent: "sent", stopped: "skipped" }[f] ?? null;
  return { filter: null, offset: null, view };
};

function Draft({
  d,
  subject,
  first,
}: {
  d: EmailDetail;
  subject: unknown;
  first: string | undefined;
}) {
  const [open, setOpen] = useState<WhyLine | null>(null);
  const flip = (w: WhyLine) => setOpen((o) => (o?.text === w.text ? null : w));
  return (
    <div className="grid gap-4">
      <div className={MAIL}>
        {subject ? <p className="mb-1.5 font-semibold">{String(subject)}</p> : null}
        <Body text={d.opener} why={d.why?.opener ?? []} open={open} onWhy={flip} />
      </div>
      {d.followup ? (
        <details>
          <summary className="w-fit cursor-pointer text-[13.5px] font-medium text-(--ui-ink-2) hover:text-(--ui-ink)">
            Follow-up, 4 days later if no reply
          </summary>
          <div className={`${MAIL} mt-2.5`}>
            <Body text={d.followup} why={d.why?.followup ?? []} open={open} onWhy={flip} />
          </div>
        </details>
      ) : null}
      {open ? <Why d={d} line={open} /> : null}
      <details>
        <summary className="w-fit cursor-pointer text-[13.5px] font-medium text-(--ui-ink-2) hover:text-(--ui-ink)">
          How it looks on a laptop and a phone
        </summary>
        <div className="mt-2.5">
          <MessagePreview
            message={{ kind: "email", from: d.from, subject: subject ? String(subject) : null }}
            body={d.opener}
          />
        </div>
      </details>
      {d.personId ? (
        <p className="text-[13px]">
          <a href={at("people", { person: d.personId })}>See {first}'s full brief</a>
        </p>
      ) : null}
    </div>
  );
}

/** An email, paragraph by paragraph. One written from the brief can show why. */
function Body({
  text,
  why,
  open,
  onWhy,
}: {
  text: string;
  why: WhyLine[];
  open: WhyLine | null;
  onWhy: (line: WhyLine) => void;
}) {
  const byText = new Map(why.map((w) => [w.text, w]));
  return (
    <div className={MAIL_BODY}>
      {text.split(/\n{2,}/).map((para, i) => {
        const w = byText.get(para.trim());
        return w?.lines.length ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: an email's paragraphs never reorder.
          <Traced key={i} on={open?.text === w.text} onTrace={() => onWhy(w)}>
            {para}
          </Traced>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: an email's paragraphs never reorder.
          <p key={i}>{para}</p>
        );
      })}
    </div>
  );
}

/** One line traced back: the brief lines it was written from, then what they cite. */
function Why({ d, line }: { d: EmailDetail; line: WhyLine }) {
  const brief = line.lines.flatMap((i) => d.why?.brief[i] ?? []);
  const cited = new Set(brief.flatMap(marksOf));
  const sources = d.sources.filter((s) => cited.has(s.mark.toLowerCase()));
  const order = sources.map((s) => s.mark.toLowerCase());
  const [lit, pick] = useSourcePick();
  return (
    <section aria-label="Why this line" className="border-t border-(--ui-hair) pt-4">
      <Trail
        steps={[
          {
            id: "brief",
            label:
              brief.length === 1
                ? "Written from this line of the brief"
                : "Written from these lines of the brief",
            children: (
              <ul className="m-0 grid list-none gap-2 p-0">
                {brief.map((b) => (
                  <li
                    key={b}
                    className="bg-(--ui-tile) px-4 py-3 text-[14.5px] leading-[1.6] text-pretty"
                  >
                    <Cited text={b} order={order} lit={lit} onPick={pick} />
                  </li>
                ))}
              </ul>
            ),
          },
          {
            id: "found",
            label: "What we found",
            children: sources.length ? (
              <SourceCards sources={sources} lit={lit} />
            ) : (
              <p className="text-(--ui-ink-2)">These lines cite nothing we found.</p>
            ),
          },
        ]}
      />
    </section>
  );
}
