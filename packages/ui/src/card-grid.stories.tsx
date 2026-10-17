import type { Story, StoryDefault } from "@ladle/react";
import type { Thumb } from "@wren/core/records";
import { useState } from "react";
import { CardHead, CardStrip, FormSwitch, GRID, RecordCard } from "./card-grid.js";
import { cardOf, cardWords, type ListForm } from "./cards.js";
import { Button } from "./controls.js";
import {
  CARD_ROWS,
  CARD_THUMBS,
  CARDS_META,
  type CardRow,
  WORST_CARD_ROWS,
} from "./fixtures/cards.js";
import { fakePlace } from "./fixtures/place.js";

export default { title: "Card grid" } satisfies StoryDefault;

const COLUMNS = CARDS_META.fields.filter((f) => f.column);
const PARTS = cardOf(CARDS_META, COLUMNS, { badge: "state" }, [...CARD_ROWS, ...WORST_CARD_ROWS]);

/** The cards of a list, with its strip and switch; `pending` holds the pictures' places. */
function Cards({
  rows,
  pending = false,
  thumbs = CARD_THUMBS,
  sort,
  band,
}: {
  rows: CardRow[];
  pending?: boolean;
  thumbs?: Record<string, Thumb>;
  sort?: string;
  band?: string;
}) {
  const [form, setForm] = useState<ListForm>("cards");
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const place = fakePlace(sort ? `sort=${sort}` : "");
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <FormSwitch form={form} onChange={setForm} />
        <span className="text-[12px] text-(--ui-ink-3)">{form}</span>
      </div>
      <CardStrip
        meta={CARDS_META}
        place={place}
        sort={sort}
        all={!!rows.length && picked.length === rows.length}
        some={picked.length > 0}
        onAll={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => String(r.id)))}
      />
      <ul className={GRID}>
        {band ? <CardHead>{band}</CardHead> : null}
        {rows.map((row, i) => {
          const id = String(row.id);
          const read = (k: string) => String(row[k] ?? "");
          const words = cardWords(PARTS, read);
          return (
            <RecordCard
              key={id}
              row={row}
              index={i}
              parts={PARTS}
              thumb={thumbs[id]}
              pending={pending}
              title={words.title}
              titleClass="text-(--ui-ink) font-medium"
              body={words.body}
              spent={words.spent}
              quiet={false}
              href={place.page(id)}
              cursor={i === 0}
              open={open === id}
              changed={false}
              picked={picked.includes(id)}
              anyPicked={picked.length > 0}
              onPick={() => toggle(id)}
              onOpen={() => setOpen(open === id ? null : id)}
              onSettled={() => {}}
              actions={
                <Button tone="quiet" size="dense">
                  Open
                </Button>
              }
            />
          );
        })}
      </ul>
    </div>
  );
}

/** Four cards under a band, with the switch and the sort line; click a card to open it. */
export const Default: Story = () => <Cards rows={CARD_ROWS} band="This week" sort="-count" />;

/** No rows: the switch and strip stay, the grid is empty. The page adds its own empty line. */
export const Empty: Story = () => <Cards rows={[]} />;

/** The nearest real state: cards have no loading state, so pictures still on their way show a quiet box. */
export const Loading: Story = () => <Cards rows={CARD_ROWS} pending thumbs={{}} />;

/** The nearest real state: cards have no error state, so rows that failed carry the Failed badge. */
export const Failed: Story = () => <Cards rows={CARD_ROWS.filter((r) => r.state === "failed")} />;

/** Long titles and words, huge numbers, mixed scripts, and a row with nothing in it. */
export const WorstCase: Story = () => <Cards rows={WORST_CARD_ROWS} sort="count" />;
